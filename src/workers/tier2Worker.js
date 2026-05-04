import { pipeline } from '@huggingface/transformers'
import { computeDisfluency } from '../utils/signals.js'

let transcriber = null
let sessionStartTime = null
let currentQuestionTitle = ''

const DRIFT_CLAMP_MS = 500

let sessionAudioContextStartTime = null
let sessionAudioContextStartWallTime = null
let lastCompletePcm = null
let lastCompleteSampleRate = null
let inferenceInFlight = false   // Drop new chunks while ORT is computing (prevents queue backup)

self.onmessage = async (e) => {
  const data = e?.data
  if (!data || typeof data.type !== 'string') {
    console.warn('[Tier2Worker] dropping malformed message', data)
    return
  }
  const { type } = data
  try {
    switch (type) {
      case 'LOAD_MODELS': await handleLoadModels(); break
      case 'START_SESSION': handleStartSession(data); break
      case 'AUDIO_CHUNK': await handleAudioChunk(data); break
      case 'END_SESSION':
        // Respond instantly — no await, no transcription. Skipping the final
        // chunk's disfluency is a deliberate tradeoff to keep the UI responsive.
        lastCompletePcm = null
        console.log('[Tier2Worker] END_SESSION — posting FLUSH_COMPLETE immediately')
        self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
        break
      case 'RESET': handleReset(); break
      default: console.warn('[Tier2Worker] unknown message type:', type)
    }
  } catch (err) {
    console.error(`[Tier2Worker] handler '${type}' threw:`, err)
    if (type === 'END_SESSION') {
      self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
    }
  }
}

async function handleLoadModels() {
  // Whisper fp32 on WASM CPU takes 4-8s per chunk, blocking the worker thread and
  // deadlocking END_SESSION. Disabled until ORT proxy-worker mode is configured.
  transcriber = null
  self.postMessage({ type: 'WORKER_READY' })
}

function handleStartSession({ sessionStartTime: t, currentQuestionTitle: q }) {
  sessionStartTime = t
  currentQuestionTitle = q
  console.log('[Tier2Worker] BUFFERING — session started')
}

async function handleAudioChunk(data) {
  if (!transcriber || !sessionStartTime) return
  // G1-equivalent for ASR — drop chunks while inference is busy. Without this,
  // chunks queue up faster than fp32 Whisper can process them, blocking END_SESSION.
  if (inferenceInFlight) {
    console.log('[Tier2Worker] inference busy — dropping audio chunk')
    return
  }

  if (sessionAudioContextStartTime === null) {
    sessionAudioContextStartTime = data.audioContextTime
    sessionAudioContextStartWallTime = data.wallTime
  }

  lastCompletePcm = data.pcmData
  lastCompleteSampleRate = data.sampleRate

  inferenceInFlight = true
  try {
    const result = await transcriber(data.pcmData, { sampling_rate: data.sampleRate })
    const text = result.text?.trim() ?? ''
    if (!text) return

    const disfluency = computeDisfluency(text)
    const { correctedStart, correctedEnd } = correctChunkTimestamps(data)

    self.postMessage({
      type: 'TRANSCRIPT_CHUNK',
      start: correctedStart,
      end: correctedEnd,
      topic: currentQuestionTitle,
      text,
      disfluency,
    })
  } catch (err) {
    console.warn('[Tier2Worker] Whisper inference error:', err)
  } finally {
    inferenceInFlight = false
  }
}

function correctChunkTimestamps(data) {
  const audioMs = data.audioContextTime * 1000
  const rawDrift = data.wallTime - audioMs
  const driftMs = Math.max(-DRIFT_CLAMP_MS, Math.min(DRIFT_CLAMP_MS, rawDrift))

  const chunkDurationMs = (data.pcmData.length / data.sampleRate) * 1000
  const correctedEnd = data.wallTime + driftMs
  const correctedStart = Math.max(0, correctedEnd - chunkDurationMs)

  return { correctedStart, correctedEnd }
}

async function handleEndSession() {
  console.log('[Tier2Worker] END_SESSION received — transcriber loaded:', !!transcriber, 'lastPcm:', lastCompletePcm?.length ?? 0)
  if (lastCompletePcm && lastCompletePcm.length > 0 && transcriber && sessionStartTime) {
    try {
      const result = await transcriber(lastCompletePcm, { sampling_rate: lastCompleteSampleRate ?? 48_000 })
      const text = result.text?.trim() ?? ''
      if (text) {
        const disfluency = computeDisfluency(text)
        self.postMessage({
          type: 'TRANSCRIPT_CHUNK',
          start: 0,
          end: performance.now() - sessionStartTime,
          topic: currentQuestionTitle,
          text,
          disfluency,
        })
      }
    } catch (_) {}
  }
  lastCompletePcm = null
  console.log('[Tier2Worker] posting FLUSH_COMPLETE')
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
}

function handleReset() {
  sessionStartTime = null
  currentQuestionTitle = ''
  sessionAudioContextStartTime = null
  sessionAudioContextStartWallTime = null
  lastCompletePcm = null
  lastCompleteSampleRate = null
  inferenceInFlight = false
  console.log('[Tier2Worker] RESET')
}
