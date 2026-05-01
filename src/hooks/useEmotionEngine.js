import { useRef, useState } from 'react'

/**
 * Stub implementation — returns immediately-ready state with no workers.
 * Replace individual functions with real implementations in Tasks 5–15.
 */
export function useEmotionEngine({ streamRef, audioLevelRef, canvasRef, currentQuestionTitle }) {
  const [tier1Ready] = useState(true)
  const [tier2Ready] = useState(false)
  const [tier2StartOffsetMs, setTier2StartOffsetMs] = useState(null)
  const signalEventsRef = useRef([])

  function startSession(sessionStartTime) {}
  async function endSession() {}
  async function resetEngine() {}

  return {
    tier1Ready,
    tier2Ready,
    tier2StartOffsetMs,
    startSession,
    endSession,
    resetEngine,
    signalEventsRef,
  }
}
