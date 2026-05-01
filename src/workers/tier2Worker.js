// Tier2Worker — stub; Whisper added in Task 8
self.onmessage = async ({ data }) => {
  switch (data.type) {
    case 'LOAD_MODELS': await handleLoadModels(); break
    case 'START_SESSION': break
    case 'AUDIO_CHUNK': break
    case 'END_SESSION': handleEndSession(); break
    case 'RESET': break
  }
}

async function handleLoadModels() {
  // Whisper load added in Task 8 — stub replies ready immediately
  self.postMessage({ type: 'WORKER_READY' })
}

function handleEndSession() {
  // Real flush added in Task 12; stub replies immediately
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
}
