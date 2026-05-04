// AggregatorWorker — Tier 1
// Owns the canonical session timeline and sliding event buffer.
// State machine: IDLE → LOADING → READY → ARMED → RUNNING → FLUSHING → IDLE

import { pipeline, RawImage } from '@huggingface/transformers'
import { computeFacialTension, updateCadenceState, updateFreezeCount } from '../utils/signals.js'

// Maps model label strings to the SignalEvent schema property names.
// Some FER model checkpoints use 'fear'/'disgust'/'surprise' (truncated);
// others use 'fearful'/'disgusted'/'surprised'. Both forms are handled here.
const FER_LABEL_MAP = {
  fear: 'fearful', fearful: 'fearful',
  disgust: 'disgusted', disgusted: 'disgusted',
  surprise: 'surprised', surprised: 'surprised',
  happy: 'happy', sad: 'sad', angry: 'angry', neutral: 'neutral',
}

function parseFerResults(results) {
  const out = { neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0 }
  for (const { label, score } of results) {
    const key = FER_LABEL_MAP[label.toLowerCase()]
    if (key) out[key] = score
  }
  return out
}

let fer = null
let sessionStartTime = null
let inferenceInFlight = false   // Guard G1
let ending = false              // Set on END_SESSION — causes in-flight FER to exit early
let sharedCanvas = null
let sharedCtx = null

let buffer = []
let sequenceNum = 0
let cadenceState = { lastSilenceStartRaw: null, lastSpeechStartRaw: null, silenceBeforeSpeech: 0 }
let latestCadenceResult = { cadence_gap: false, speech_rush: false, acoustic_disfluency: false }
let freezeCount = 0

const BUFFER_WINDOW_MS = 10_000

self.onmessage = async (e) => {
  const data = e?.data
  if (!data || typeof data.type !== 'string') {
    console.warn('[AggregatorWorker] dropping malformed message', data)
    return
  }
  const { type } = data
  try {
    switch (type) {
      case 'LOAD_MODELS': await handleLoadModels(); break
      case 'START_SESSION': handleStartSession(data); break
      case 'FRAME_DATA': await handleFrameData(data); break
      case 'TRANSCRIPT_CHUNK': handleTranscriptChunk(data); break
      case 'END_SESSION': handleEndSession(); break
      case 'RESET': handleReset(); break
      default: console.warn('[AggregatorWorker] unknown message type:', type)
    }
  } catch (err) {
    console.error(`[AggregatorWorker] handler '${type}' threw:`, err)
    // If the failure happened during END_SESSION, still emit FLUSH_COMPLETE so the
    // main thread doesn't deadlock waiting for it.
    if (type === 'END_SESSION') {
      self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
    }
  }
}

async function handleLoadModels() {
  fer = await pipeline('image-classification', 'Xenova/facial_emotions_image_detection')
  self.postMessage({ type: 'WORKER_READY' })
}

function handleStartSession({ sessionStartTime: t }) {
  sequenceNum = 0
  sessionStartTime = t
  console.log('[AggregatorWorker] ARMED — sessionStartTime:', t)
}

async function handleFrameData(data) {
  const tickNow = data.rawTimestamp   // Guard G2: single clock per tick

  // 1. Update cadence state on every frame
  const { cadence_gap, speech_rush, acoustic_disfluency, nextState } = updateCadenceState(data.audio, tickNow, cadenceState)
  cadenceState = nextState

  latestCadenceResult.cadence_gap = cadence_gap
  if (speech_rush) latestCadenceResult.speech_rush = true
  if (acoustic_disfluency) latestCadenceResult.acoustic_disfluency = true

  // Guard G1: single in-flight inference
  if (inferenceInFlight) { data.frame?.close(); return }
  if (!fer || !sessionStartTime) { data.frame?.close(); return }
  if (ending) { data.frame?.close(); return }

  inferenceInFlight = true

  try {
    // 2. FER inference — reuse a single canvas to avoid per-frame allocation leaks
    if (!sharedCanvas) {
      sharedCanvas = new OffscreenCanvas(data.frame.width, data.frame.height)
      sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true })
    } else if (sharedCanvas.width !== data.frame.width || sharedCanvas.height !== data.frame.height) {
      sharedCanvas.width = data.frame.width
      sharedCanvas.height = data.frame.height
    }
    sharedCtx.drawImage(data.frame, 0, 0)
    const imageData = sharedCtx.getImageData(0, 0, sharedCanvas.width, sharedCanvas.height)
    const image = new RawImage(imageData.data, imageData.width, imageData.height, 4)
    const results = await fer(image)

    // END_SESSION may have arrived while awaiting FER — bail out without building the event
    if (ending) { return }

    const ferVector = parseFerResults(results)

    // 3. Derived signals
    const facial_tension = computeFacialTension(ferVector)
    
    const latestCadenceGap = latestCadenceResult.cadence_gap
    const latestSpeechRush = latestCadenceResult.speech_rush
    const latestDisfluency = latestCadenceResult.acoustic_disfluency

    latestCadenceResult.speech_rush = false
    latestCadenceResult.acoustic_disfluency = false

    const { consecutiveFreezeCount: nextFreezeCount, physical_freeze } =
      updateFreezeCount(facial_tension, latestCadenceGap, data.audio.rms, freezeCount)
    freezeCount = nextFreezeCount

    // 4. Build SignalEvent
    const event = {
      id:           `sig-${sequenceNum++}`,
      rawTimestamp: tickNow,                        // internal only — stripped on emit
      timestamp:    tickNow - sessionStartTime,
      finalized:    false,
      signals: {
        facial_tension,
        cadence_gap: latestCadenceGap,
        speech_rush: latestSpeechRush,
        physical_freeze,
        linguistic_disfluency: latestDisfluency ? 0.5 : null,
        raw: { fer: ferVector, audio: data.audio },
      },
      context: null,
    }

    // Guard G4: dev-only monotonicity assertion
    if (import.meta.env?.DEV && buffer.length > 0) {
      const prev = buffer[buffer.length - 1]
      console.assert(
        tickNow >= prev.rawTimestamp,
        '[AggregatorWorker] G4 monotonicity violated: %d < %d', tickNow, prev.rawTimestamp
      )
    }

    buffer.push(event)

    // 4. Finalization pass using same tickNow
    runFinalizationPass(tickNow)

  } finally {
    data.frame?.close()   // early-exit guards also close frame on their paths; this covers the normal path
    inferenceInFlight = false
  }
}

function runFinalizationPass(tickNow) {
  const ready = buffer.filter(e => (tickNow - e.rawTimestamp) > BUFFER_WINDOW_MS)
  for (const event of ready) {
    event.finalized = true
    const { rawTimestamp, ...emittable } = event
    self.postMessage({ type: 'SIGNAL_EVENT', event: emittable })
  }
  buffer = buffer.filter(e => !e.finalized)
}

function handleTranscriptChunk({ start, end, topic, text, disfluency }) {
  if (!sessionStartTime) return

  const absStart = sessionStartTime + start
  const absEnd   = sessionStartTime + end

  for (const event of buffer) {
    if (event.rawTimestamp < absStart || event.rawTimestamp > absEnd) continue

    // Overwrite with the latest interim or final result score
    event.signals.linguistic_disfluency = Math.max(event.signals.linguistic_disfluency || 0, disfluency)
    event.context = { text, topic, chunkStart: start, chunkEnd: end }
  }
  // Events already finalized (removed from buffer) are silently skipped — expected behavior
}

function handleEndSession() {
  ending = true
  console.log('[AggregatorWorker] END_SESSION — flushing', buffer.length, 'buffered events')
  for (const event of buffer) {
    event.finalized = true
    const { rawTimestamp, ...emittable } = event
    self.postMessage({ type: 'SIGNAL_EVENT', event: emittable })
  }
  buffer = []
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
}

function handleReset() {
  buffer = []
  sequenceNum = 0
  cadenceState = { lastSilenceStartRaw: null, lastSpeechStartRaw: null, silenceBeforeSpeech: 0 }
  freezeCount = 0
  latestCadenceResult = { cadence_gap: false, speech_rush: false, acoustic_disfluency: false }
  inferenceInFlight = false
  ending = false
  sessionStartTime = null
  sharedCanvas = null
  sharedCtx = null
  console.log('[AggregatorWorker] RESET')
}
