import { useEffect, useRef, useState } from 'react'

export function useEmotionEngine({ streamRef, audioLevelRef, canvasRef, currentQuestionTitle }) {
  const [tier1Ready, setTier1Ready] = useState(false)
  const [tier2Ready, setTier2Ready] = useState(false)
  const [tier2StartOffsetMs, setTier2StartOffsetMs] = useState(null)

  const aggregatorRef = useRef(null)
  const tier2Ref = useRef(null)
  const signalEventsRef = useRef([])
  const sessionStartTimeRef = useRef(null)
  const pendingTier2StartRef = useRef(null)
  const endingRef = useRef(false)
  const endingPromiseRef = useRef(null)
  const flushResolveRef = useRef(null)
  const frameIntervalRef = useRef(null)
  const audioFlushIntervalRef = useRef(null)

  // Lobby warmup — create workers on mount
  useEffect(() => {
    const aggregator = new Worker(
      new URL('../workers/aggregatorWorker.js', import.meta.url),
      { type: 'module' }
    )
    aggregatorRef.current = aggregator
    aggregator.onmessage = handleAggregatorMessage
    aggregator.postMessage({ type: 'LOAD_MODELS' })

    const tier2 = new Worker(
      new URL('../workers/tier2Worker.js', import.meta.url),
      { type: 'module' }
    )
    tier2Ref.current = tier2
    tier2.onmessage = handleTier2Message
    tier2.postMessage({ type: 'LOAD_MODELS' })

    return () => {
      aggregator.terminate()
      tier2.terminate()
    }
  }, [])

  function handleAggregatorMessage({ data }) {
    if (data.type === 'WORKER_READY') {
      setTier1Ready(true)
    } else if (data.type === 'SIGNAL_EVENT') {
      signalEventsRef.current.push(data.event)
    } else if (data.type === 'FLUSH_COMPLETE') {
      if (flushResolveRef.current) {
        flushResolveRef.current()
        flushResolveRef.current = null
      }
    }
  }

  function handleTier2Message({ data }) {
    if (data.type === 'WORKER_READY') {
      setTier2Ready(true)
      if (pendingTier2StartRef.current) {
        const { sessionStartTime, currentQuestionTitle } = pendingTier2StartRef.current
        tier2Ref.current.postMessage({ type: 'START_SESSION', sessionStartTime, currentQuestionTitle })
        setTier2StartOffsetMs(performance.now() - sessionStartTime)
        pendingTier2StartRef.current = null
      }
    } else if (data.type === 'TRANSCRIPT_CHUNK') {
      aggregatorRef.current.postMessage(data)   // relay verbatim
    } else if (data.type === 'FLUSH_COMPLETE') {
      // Tier 2 done — now trigger Tier 1 flush (see spec §8)
      aggregatorRef.current.postMessage({ type: 'END_SESSION' })
    }
  }

  function startSession(sessionStartTime) {
    signalEventsRef.current = []
    sessionStartTimeRef.current = sessionStartTime

    aggregatorRef.current.postMessage({ type: 'START_SESSION', sessionStartTime })

    if (tier2Ready) {
      tier2Ref.current.postMessage({ type: 'START_SESSION', sessionStartTime, currentQuestionTitle })
      setTier2StartOffsetMs(0)
    } else {
      pendingTier2StartRef.current = { sessionStartTime, currentQuestionTitle }
    }

    startFrameCapture()
    // Audio chunk flush added in Task 11
  }

  function startFrameCapture() {
    frameIntervalRef.current = setInterval(async () => {
      if (!canvasRef.current || !sessionStartTimeRef.current) return
      try {
        const frame = await createImageBitmap(canvasRef.current)
        aggregatorRef.current.postMessage(
          {
            type: 'FRAME_DATA',
            frame,
            audio: {
              rms: (audioLevelRef.current ?? 0) / 100,
              isSpeaking: (audioLevelRef.current ?? 0) > 5,
            },
            rawTimestamp: performance.now(),
          },
          [frame]
        )
      } catch (_) {
        // Canvas may not be ready — skip this frame
      }
    }, 500)
  }

  async function endSession() {
    if (endingRef.current) return endingPromiseRef.current
    endingRef.current = true

    clearInterval(frameIntervalRef.current)
    clearInterval(audioFlushIntervalRef.current)
    frameIntervalRef.current = null
    audioFlushIntervalRef.current = null

    endingPromiseRef.current = new Promise((resolve) => {
      flushResolveRef.current = resolve
      // Send END_SESSION to Tier 2 — the chain in handleTier2Message
      // waits for tier2 FLUSH_COMPLETE then triggers aggregator END_SESSION
      // which resolves this promise via handleAggregatorMessage
      tier2Ref.current.postMessage({ type: 'END_SESSION' })
    })
    return endingPromiseRef.current
  }

  async function resetEngine() {
    if (endingRef.current && endingPromiseRef.current) {
      try { await endingPromiseRef.current } catch (_) {}
    }

    clearInterval(frameIntervalRef.current)
    clearInterval(audioFlushIntervalRef.current)
    frameIntervalRef.current = null
    audioFlushIntervalRef.current = null

    signalEventsRef.current = []
    sessionStartTimeRef.current = null
    pendingTier2StartRef.current = null
    endingRef.current = false
    endingPromiseRef.current = null
    flushResolveRef.current = null
    setTier2StartOffsetMs(null)

    aggregatorRef.current.postMessage({ type: 'RESET' })
    tier2Ref.current.postMessage({ type: 'RESET' })
  }

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
