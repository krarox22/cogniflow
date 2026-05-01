import { pipeline } from '@xenova/transformers'
import { computeDisfluency } from '../utils/signals.js'

let transcriber = null
let sessionStartTime = null
let currentQuestionTitle = ''

const DRIFT_CLAMP_MS = 500

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
  // Implemented in Task 10
  console.log('[Tier2Worker] AUDIO_CHUNK received, wallTime:', data.wallTime)
}

async function handleEndSession() {
  // Flush implemented in Task 10
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
}

function handleReset() {
  sessionStartTime = null
  currentQuestionTitle = ''
  console.log('[Tier2Worker] RESET')
}
