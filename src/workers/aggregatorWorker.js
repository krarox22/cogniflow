// AggregatorWorker — Tier 1
// Receives pre-computed emotion floats from the main thread, runs cadence
// state machine + freeze detector, and stamps emotion values onto finalized
// SignalEvents emitted to the main thread.
//
// State machine: IDLE → READY → ARMED → RUNNING → FLUSHING → IDLE
// (No model load — WORKER_READY is fired immediately on LOAD_MODELS for
// API parity with the previous Hugging Face flow.)

import { updateCadenceState, updateFreezeCount } from '../utils/signals.js'

let sessionStartTime = null
let ending = false

let buffer = []
let sequenceNum = 0
let cadenceState = { lastSilenceStartRaw: null, lastSpeechStartRaw: null, silenceBeforeSpeech: 0 }
let latestCadenceResult = { cadence_gap: false, speech_rush: false, acoustic_disfluency: false }
let freezeCount = 0

const BUFFER_WINDOW_MS = 10_000

self.onmessage = (e) => {
  const data = e?.data
  if (!data || typeof data.type !== 'string') {
    console.warn('[AggregatorWorker] dropping malformed message', data)
    return
  }
  const { type } = data
  try {
    switch (type) {
      case 'LOAD_MODELS':       handleLoadModels(); break
      case 'START_SESSION':     handleStartSession(data); break
      case 'FRAME_DATA':        handleFrameData(data); break
      case 'TRANSCRIPT_CHUNK':  handleTranscriptChunk(data); break
      case 'END_SESSION':       handleEndSession(); break
      case 'RESET':             handleReset(); break
      default: console.warn('[AggregatorWorker] unknown message type:', type)
    }
  } catch (err) {
    console.error(`[AggregatorWorker] handler '${type}' threw:`, err)
    if (type === 'END_SESSION') {
      self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
    }
  }
}

function handleLoadModels() {
  self.postMessage({ type: 'WORKER_READY' })
}

function handleStartSession({ sessionStartTime: t }) {
  sequenceNum = 0
  sessionStartTime = t
  console.log('[AggregatorWorker] ARMED — sessionStartTime:', t)
}

function handleFrameData(data) {
  const tickNow = data.rawTimestamp
  const emotions = data.emotions || {}

  const { cadence_gap, speech_rush, acoustic_disfluency, nextState } =
    updateCadenceState(data.audio, tickNow, cadenceState)
  cadenceState = nextState

  latestCadenceResult.cadence_gap = cadence_gap
  if (speech_rush) latestCadenceResult.speech_rush = true
  if (acoustic_disfluency) latestCadenceResult.acoustic_disfluency = true

  if (!sessionStartTime || ending) return

  const facial_tension = typeof emotions.facial_tension === 'number' ? emotions.facial_tension : 0

  const latestCadenceGap = latestCadenceResult.cadence_gap
  const latestSpeechRush = latestCadenceResult.speech_rush
  const latestDisfluency = latestCadenceResult.acoustic_disfluency

  latestCadenceResult.speech_rush = false
  latestCadenceResult.acoustic_disfluency = false

  const { consecutiveFreezeCount: nextFreezeCount, physical_freeze } =
    updateFreezeCount(facial_tension, latestCadenceGap, data.audio.rms, freezeCount)
  freezeCount = nextFreezeCount

  const event = {
    id:           `sig-${sequenceNum++}`,
    rawTimestamp: tickNow,
    timestamp:    tickNow - sessionStartTime,
    finalized:    false,
    signals: {
      facial_tension,
      cadence_gap:           latestCadenceGap,
      speech_rush:           latestSpeechRush,
      physical_freeze,
      linguistic_disfluency: latestDisfluency ? 0.5 : null,
      smile:    typeof emotions.smile    === 'number' ? emotions.smile    : 0,
      fear:     typeof emotions.fear     === 'number' ? emotions.fear     : 0,
      anger:    typeof emotions.anger    === 'number' ? emotions.anger    : 0,
      contempt: typeof emotions.contempt === 'number' ? emotions.contempt : 0,
      raw:      { audio: data.audio },
    },
    context: null,
  }

  if (import.meta.env?.DEV && buffer.length > 0) {
    const prev = buffer[buffer.length - 1]
    console.assert(
      tickNow >= prev.rawTimestamp,
      '[AggregatorWorker] G4 monotonicity violated: %d < %d', tickNow, prev.rawTimestamp,
    )
  }

  buffer.push(event)
  runFinalizationPass(tickNow)
}

function runFinalizationPass(tickNow) {
  const ready = buffer.filter(e => (tickNow - e.rawTimestamp) > BUFFER_WINDOW_MS)
  for (const event of ready) {
    event.finalized = true
    const emittable = { ...event }
    delete emittable.rawTimestamp
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
    event.signals.linguistic_disfluency = Math.max(event.signals.linguistic_disfluency || 0, disfluency)
    event.context = { text, topic, chunkStart: start, chunkEnd: end }
  }
}

function handleEndSession() {
  ending = true
  console.log('[AggregatorWorker] END_SESSION — flushing', buffer.length, 'buffered events')
  for (const event of buffer) {
    event.finalized = true
    const emittable = { ...event }
    delete emittable.rawTimestamp
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
  ending = false
  sessionStartTime = null
  console.log('[AggregatorWorker] RESET')
}
