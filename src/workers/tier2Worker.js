import { pipeline } from '@xenova/transformers'
import { computeDisfluency } from '../utils/signals.js'

let transcriber = null
let sessionStartTime = null
let currentQuestionTitle = ''

const DRIFT_CLAMP_MS = 500

let sessionAudioContextStartTime = null
let sessionAudioContextStartWallTime = null
let pendingPcm = null

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case 'LOAD_MODELS': await handleLoadModels(); break
    case 'START_SESSION': handleStartSession(data); break
    case 'AUDIO_CHUNK': await handleAudioChunk(data); break
    case 'END_SESSION': await handleEndSession(); break
    case 'RESET': handleReset(); break
  }
}

async function handleLoadModels() {
  transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny')
  self.postMessage({ type: 'WORKER_READY' })
}

function handleStartSession({ sessionStartTime: t, currentQuestionTitle: q }) {
  sessionStartTime = t
  currentQuestionTitle = q
  console.log('[Tier2Worker] BUFFERING — session started')
}

async function handleAudioChunk(data) {
  if (!transcriber || !sessionStartTime) return

  // First chunk establishes audio clock anchor
  if (sessionAudioContextStartTime === null) {
    sessionAudioContextStartTime = data.audioContextTime
    sessionAudioContextStartWallTime = data.wallTime
  }

  pendingPcm = data.pcmData   // track last chunk for END_SESSION partial flush

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
  if (pendingPcm && pendingPcm.length > 0 && transcriber && sessionStartTime) {
    try {
      const result = await transcriber(pendingPcm, { sampling_rate: 48_000 })
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
  pendingPcm = null
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
}

function handleReset() {
  sessionStartTime = null
  currentQuestionTitle = ''
  sessionAudioContextStartTime = null
  sessionAudioContextStartWallTime = null
  pendingPcm = null
  console.log('[Tier2Worker] RESET')
}
