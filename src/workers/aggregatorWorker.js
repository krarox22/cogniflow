// AggregatorWorker — Tier 1
// Owns the canonical session timeline and sliding event buffer.
// State machine: IDLE → LOADING → READY → ARMED → RUNNING → FLUSHING → IDLE

import { pipeline } from '@xenova/transformers'

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

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case 'LOAD_MODELS': await handleLoadModels(); break
    case 'START_SESSION': handleStartSession(data); break
    case 'FRAME_DATA': await handleFrameData(data); break
    case 'TRANSCRIPT_CHUNK': handleTranscriptChunk(data); break
    case 'END_SESSION': handleEndSession(); break
    case 'RESET': handleReset(); break
  }
}

async function handleLoadModels() {
  fer = await pipeline('image-classification', 'Xenova/facial-expression-recognition')
  self.postMessage({ type: 'WORKER_READY' })
}

function handleStartSession({ sessionStartTime: t }) {
  sessionStartTime = t
  console.log('[AggregatorWorker] ARMED — sessionStartTime:', t)
}

async function handleFrameData(data) {
  // Guard G1: single in-flight inference — drop frame if busy
  if (inferenceInFlight) { data.frame?.close(); return }
  if (!fer || !sessionStartTime) { data.frame?.close(); return }

  inferenceInFlight = true
  const tickNow = data.rawTimestamp   // Guard G2: single clock per tick

  try {
    // Convert ImageBitmap → ImageData via OffscreenCanvas for pipeline input
    const canvas = new OffscreenCanvas(data.frame.width, data.frame.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(data.frame, 0, 0)
    data.frame.close()
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    const results = await fer(imageData)
    const ferVector = parseFerResults(results)

    console.log('[AggregatorWorker] FER:', ferVector)
  } finally {
    inferenceInFlight = false
  }
}

function handleTranscriptChunk(data) {
  // Backfill implemented in Task 11
  console.log('[AggregatorWorker] TRANSCRIPT_CHUNK received:', data.topic)
}

function handleEndSession() {
  // Flush implemented in Task 12
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
}

function handleReset() {
  sessionStartTime = null
  console.log('[AggregatorWorker] RESET')
}
