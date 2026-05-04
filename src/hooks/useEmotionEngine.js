import { useEffect, useRef, useState } from 'react'
import { computeDisfluency } from '../utils/signals'

export function useEmotionEngine({ streamRef, audioLevelRef, canvasRef, currentQuestionTitle, audioThresholdRef }) {
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

  const frameIntervalRef = useRef(null)
  const audioFlushIntervalRef = useRef(null)
  const audioContextRef = useRef(null)
  const audioWorkletNodeRef = useRef(null)
  const speechRecognitionRef = useRef(null)

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

  // AudioWorklet cleanup on unmount
  useEffect(() => {
    return () => {
      audioWorkletNodeRef.current?.disconnect()
      audioContextRef.current?.close()
    }
  }, [])

  function handleAggregatorMessage({ data }) {
    if (data.type === 'WORKER_READY') {
      setTier1Ready(true)
    } else if (data.type === 'SIGNAL_EVENT') {
      signalEventsRef.current.push(data.event)
    }
    // FLUSH_COMPLETE is now handled by the temporary listener in endSession()
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
    }
    // FLUSH_COMPLETE is now handled by the temporary listener in endSession()
  }

  async function setupAudioWorklet() {
    if (!streamRef.current) return

    let audioCtx = null
    try {
      audioCtx = new AudioContext()
      audioContextRef.current = audioCtx

      const processorUrl = new URL('../workers/pcmCaptureProcessor.js', import.meta.url).href
      await audioCtx.audioWorklet.addModule(processorUrl)

      const source = audioCtx.createMediaStreamSource(streamRef.current)
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture')
      audioWorkletNodeRef.current = workletNode

      workletNode.port.onmessage = ({ data }) => {
        if (data.type !== 'PCM_FLUSH') return
        if (!sessionStartTimeRef.current || !tier2Ref.current) return

        tier2Ref.current.postMessage(
          {
            type: 'AUDIO_CHUNK',
            pcmData: data.pcm,
            sampleRate: data.sampleRate,
            audioContextTime: audioCtx.currentTime,
            wallTime: performance.now() - sessionStartTimeRef.current,
          },
          [data.pcm.buffer]
        )
      }

      source.connect(workletNode)
    } catch (err) {
      console.warn('[useEmotionEngine] AudioWorklet setup failed:', err)
      audioCtx?.close()
      audioContextRef.current = null
      audioWorkletNodeRef.current = null
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
  }

  function startCapture() {
    startFrameCapture()
    void setupAudioWorklet()

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onresult = (event) => {
        if (!sessionStartTimeRef.current) return
        const lastResult = event.results[event.results.length - 1]

        const text = lastResult[0].transcript.trim()
        if (!text) return

        // For interim results, we just compute disfluency and patch the last 1.5 seconds.
        const disfluency = computeDisfluency(text)
        const now = performance.now() - sessionStartTimeRef.current

        aggregatorRef.current.postMessage({
          type: 'TRANSCRIPT_CHUNK',
          start: Math.max(0, now - 1500),
          end: now,
          topic: currentQuestionTitle,
          text,
          disfluency,
        })
      }
      recognition.onend = () => {
        if (sessionStartTimeRef.current && speechRecognitionRef.current) {
          try {
            recognition.start()
          } catch (err) { }
        }
      }

      try {
        recognition.start()
        speechRecognitionRef.current = recognition
      } catch (err) {
        console.warn('SpeechRecognition start failed:', err)
      }
    }
  }

  function startFrameCapture() {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
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
              isSpeaking: (audioLevelRef.current ?? 0) > (audioThresholdRef?.current ?? 12),
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
    pendingTier2StartRef.current = null

    clearInterval(frameIntervalRef.current)
    clearInterval(audioFlushIntervalRef.current)
    frameIntervalRef.current = null
    audioFlushIntervalRef.current = null

    audioWorkletNodeRef.current?.disconnect()
    audioContextRef.current?.close()
    audioWorkletNodeRef.current = null
    audioContextRef.current = null

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop()
      speechRecognitionRef.current = null
    }

    console.log('[endSession] posting END_SESSION to both workers simultaneously')

    // Attach temporary listener to Tier 1
    const tier1Promise = new Promise((resolve) => {
      const handler = (e) => {
        if (e.data?.type === 'FLUSH_COMPLETE') {
          console.log('[hook] tier1 FLUSH_COMPLETE')
          aggregatorRef.current.removeEventListener('message', handler)
          resolve()
        }
      }
      aggregatorRef.current.addEventListener('message', handler)
      aggregatorRef.current.postMessage({ type: 'END_SESSION' })
    })

    // Attach temporary listener to Tier 2
    const tier2Promise = new Promise((resolve) => {
      const handler = (e) => {
        if (e.data?.type === 'FLUSH_COMPLETE') {
          console.log('[hook] tier2 FLUSH_COMPLETE')
          tier2Ref.current.removeEventListener('message', handler)
          resolve()
        }
      }
      tier2Ref.current.addEventListener('message', handler)
      tier2Ref.current.postMessage({ type: 'END_SESSION' })
    })

    // 15-second failsafe timeout
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.warn('[endSession] flush timed out after 15s — resolving anyway')
        resolve()
      }, 15000)
    })

    // Race the parallel workers against the timeout
    endingPromiseRef.current = Promise.race([
      Promise.all([tier1Promise, tier2Promise]),
      timeoutPromise,
    ]).then(() => {
      // Ensure the final promise resolves with the requested context
      return { signalEvents: signalEventsRef.current }
    })

    return endingPromiseRef.current
  }

  async function resetEngine() {
    if (endingRef.current && endingPromiseRef.current) {
      try { await endingPromiseRef.current } catch (_) { }
    }

    clearInterval(frameIntervalRef.current)
    clearInterval(audioFlushIntervalRef.current)
    frameIntervalRef.current = null
    audioFlushIntervalRef.current = null

    audioWorkletNodeRef.current?.disconnect()
    audioContextRef.current?.close()
    audioWorkletNodeRef.current = null
    audioContextRef.current = null

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop()
      speechRecognitionRef.current = null
    }

    signalEventsRef.current = []
    sessionStartTimeRef.current = null
    pendingTier2StartRef.current = null
    endingRef.current = false
    endingPromiseRef.current = null
    setTier2StartOffsetMs(null)

    aggregatorRef.current.postMessage({ type: 'RESET' })
    tier2Ref.current.postMessage({ type: 'RESET' })
  }

  return {
    tier1Ready,
    tier2Ready,
    tier2StartOffsetMs,
    startSession,
    startCapture,
    endSession,
    resetEngine,
    signalEventsRef,
  }
}