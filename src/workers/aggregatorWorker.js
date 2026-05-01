// AggregatorWorker — Tier 1
// Owns the canonical session timeline and sliding event buffer.
// State machine: IDLE → LOADING → READY → ARMED → RUNNING → FLUSHING → IDLE

let sessionStartTime = null

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
  // FER model loaded in Task 7 — skeleton just replies ready
  self.postMessage({ type: 'WORKER_READY' })
}

function handleStartSession({ sessionStartTime: t }) {
  sessionStartTime = t
  console.log('[AggregatorWorker] ARMED — sessionStartTime:', t)
}

async function handleFrameData(data) {
  // FER inference added in Task 7
  console.log('[AggregatorWorker] FRAME_DATA received, timestamp offset:',
    data.rawTimestamp - sessionStartTime, 'ms')
  data.frame?.close()
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
