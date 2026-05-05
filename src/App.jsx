import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Scatter } from 'recharts'
import { questions } from './questions'
import { useEmotionEngine } from './hooks/useEmotionEngine'
import { buildUnifiedTimeline, generateCoachingCards } from './utils/reportTimeline'
import './App.css'

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

const REPORT_SERIES = [
  { key: 'stress', label: 'Stress', color: '#d2a630', primary: true },
  { key: 'smile', label: 'Smile', color: '#3fb950', primary: true },
  { key: 'facialTension', label: 'Tension', color: '#a371f7', primary: true },
  { key: 'fear', label: 'Fear', color: '#f85149' },
  { key: 'anger', label: 'Anger', color: '#ff7b72' },
  { key: 'contempt', label: 'Contempt', color: '#79c0ff' },
  { key: 'audio', label: 'Audio', color: '#58a6ff' },
]

const DEFAULT_HIDDEN_REPORT_SERIES = {
  fear: true,
  anger: true,
  contempt: true,
  audio: true,
}

function formatPercent(value) {
  return `${Math.round(value)}%`
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '10px', fontSize: 12 }}>
        <div style={{ marginBottom: '8px', color: '#fff' }}>{`Time ${formatTime(Math.round(label))}`}</div>
        {payload.map((entry, index) => {
          if (entry.dataKey === 'stress' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Stress : ${formatPercent(entry.value)}`}</div>
          }
          if (entry.dataKey === 'facialTension' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Tension : ${formatPercent(entry.value)}`}</div>
          }
          if (entry.dataKey === 'fear' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Fear : ${formatPercent(entry.value)}`}</div>
          }
          if (entry.dataKey === 'anger' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Anger : ${formatPercent(entry.value)}`}</div>
          }
          if (entry.dataKey === 'contempt' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Contempt : ${formatPercent(entry.value)}`}</div>
          }
          if (entry.dataKey === 'smile' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Smile : ${formatPercent(entry.value)}`}</div>
          }
          if (entry.dataKey === 'audio' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Audio : ${formatPercent(entry.value)}`}</div>
          }
          if (entry.dataKey === 'pauseMarker' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Pause detected`}</div>
          }
          if (entry.dataKey === 'rushMarker' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Rush detected`}</div>
          }
          if (entry.dataKey === 'freezeMarker' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Freeze detected`}</div>
          }
          if (entry.dataKey === 'disfluencyMarker' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Disfluency detected`}</div>
          }
          if (entry.dataKey === 'tenseDisfluencyMarker' && entry.value != null) {
            return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Tense disfluency detected`}</div>
          }
          return null;
        })}
      </div>
    );
  }
  return null;
};


export default function App() {

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const earBufferRef = useRef([])
  const audioBufferRef = useRef([])
  const earThresholdRef = useRef(0.015)
  const audioThresholdRef = useRef(12)
  const audioLevelRef = useRef(0)
  const lastScoreUpdate = useRef(0)
  const lastStressUpdateRef = useRef(performance.now())
  const calibStartRef = useRef(null)
  const calibPhaseRef = useRef('idle')
  const sessionTimeRef = useRef(0)
  const stressRef = useRef(0)
  const blinkCountRef = useRef(0)
  const lastBlinkCountRef = useRef(0)
  const sessionDataRef = useRef([])
  const startingRef = useRef(false)
  const pushBlendshapesRef = useRef(null)
  const startCaptureRef = useRef(null)

  const [phase, setPhase] = useState('LOBBY')
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [stressScore, setStressScore] = useState(0)
  const [blinkCount, setBlinkCount] = useState(0)
  const [calibPhase, setCalibPhase] = useState('idle')
  const [calibProgress, setCalibProgress] = useState(0)
  const [calibBaseline, setCalibBaseline] = useState(null)
  const [sessionTime, setSessionTime] = useState(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [reportData, setReportData] = useState(null)
  const [hiddenReportSeries, setHiddenReportSeries] = useState(DEFAULT_HIDDEN_REPORT_SERIES)

  const CALIB_DURATION = 1000

  useEffect(() => { calibPhaseRef.current = calibPhase }, [calibPhase])
  useEffect(() => { stressRef.current = stressScore }, [stressScore])
  useEffect(() => { blinkCountRef.current = blinkCount }, [blinkCount])

  const currentQuestion = questions[questionIndex]

  const [endingSession, setEndingSession] = useState(false)

  const {
    tier1Ready,
    tier2StartOffsetMs,
    startSession,
    startCapture,
    pushBlendshapes,
    emotionsRef,
    endSession,
    resetEngine,
    signalEventsRef,
  } = useEmotionEngine({
    streamRef,
    currentQuestionTitle: currentQuestion.title,
  })

  useEffect(() => {
    pushBlendshapesRef.current = pushBlendshapes
    startCaptureRef.current = startCapture
  }, [pushBlendshapes, startCapture])

  useEffect(() => {
    let animId

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play()
            setCameraReady(true)
          }
        }

        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const dataArray = new Uint8Array(analyser.frequencyBinCount)







        function updateAudio() {
          analyser.getByteFrequencyData(dataArray)
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
          const level = Math.min(100, Math.round((avg / 128) * 100))
          audioLevelRef.current = level

          if (calibPhaseRef.current === 'calibrating') {
            audioBufferRef.current.push(level)
          }

          const now = Date.now()
          if (now - lastScoreUpdate.current > 500) {
            lastScoreUpdate.current = now
            setAudioLevel(level)
          }

          if (calibPhaseRef.current === 'ready') {
            const nowPerf = performance.now()
            const dtRaw = nowPerf - lastStressUpdateRef.current
            lastStressUpdateRef.current = nowPerf
            const dt = Math.min(dtRaw, 100)
            const timeScale = dt / 500

            const isLoud = level > audioThresholdRef.current + 3
            const isSilent = level < audioThresholdRef.current
            const e = emotionsRef.current
            const emotionDelta = e.fear * 4 + e.anger * 3 - e.smile * 3
            const audioDelta = isLoud ? (2 + (level / 100)) : 0
            const silenceDecay = isSilent ? -6 : (isLoud ? -1 : 0)

            setStressScore(prev => {
              const next = prev + (emotionDelta + audioDelta + silenceDecay) * timeScale
              const result = Math.max(0, Math.min(100, next))
              stressRef.current = result
              return result
            })
          }
          animId = requestAnimationFrame(updateAudio)
        }
        updateAudio()


      } catch (err) {
        if (err.name === 'NotAllowedError') {
          setCameraError('Camera and microphone access is required. Please allow access and refresh.')
        } else if (err.name === 'NotFoundError') {
          setCameraError('No camera detected. CogniFlow requires a webcam to run.')
        } else {
          setCameraError('Could not access camera. Please refresh and try again.')
        }
        console.error('Camera/mic error:', err)
      }
    }

    startCamera()

    return () => {
      cancelAnimationFrame(animId)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [emotionsRef])

  useEffect(() => {
    if (!cameraReady) return
    let detectAnimId

    async function loadFaceMesh() {
      try {
        const { FaceLandmarker, FilesetResolver } = await import(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs'
        )
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        )
        const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        })


        let lastBlinkTime = 0
        let blinkTotal = 0

        function detect() {
          const video = videoRef.current
          const canvas = canvasRef.current

          // Safely skip frames during React component transitions
          if (!video || !canvas || video.readyState < 2) {
            detectAnimId = requestAnimationFrame(detect)
            return
          }

          try {
            const ctx = canvas.getContext('2d')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight

            // Mirror the hidden webcam feed onto the visible canvas
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

            const results = faceLandmarker.detectForVideo(video, performance.now())

            if (results.faceLandmarks?.length > 0) {
              const lm = results.faceLandmarks[0]
              ctx.fillStyle = '#00ff88'
              for (const point of lm) {
                ctx.beginPath()
                ctx.arc(point.x * canvas.width, point.y * canvas.height, 1.5, 0, 2 * Math.PI)
                ctx.fill()
              }

              const ear = Math.abs(lm[159].y - lm[145].y)
              const now = Date.now()

              const blendshapeMap = {}
              const categories = results.faceBlendshapes?.[0]?.categories || []
              for (const c of categories) blendshapeMap[c.categoryName] = c.score

              pushBlendshapesRef.current?.(
                blendshapeMap,
                {
                  rms: (audioLevelRef.current ?? 0) / 100,
                  isSpeaking: (audioLevelRef.current ?? 0) > (audioThresholdRef.current ?? 12),
                },
                performance.now(),
              )

              if (calibPhaseRef.current === 'calibrating' && calibStartRef.current) {
                earBufferRef.current.push(ear)
                const elapsed = now - calibStartRef.current
                const progress = Math.min(100, Math.round((elapsed / CALIB_DURATION) * 100))
                setCalibProgress(progress)

                if (elapsed >= CALIB_DURATION) {
                  const samples = earBufferRef.current
                  const avgEar = samples.length > 0
                    ? samples.reduce((a, b) => a + b, 0) / samples.length
                    : 0.015
                  earThresholdRef.current = avgEar * 0.70
                  setCalibBaseline(avgEar.toFixed(4))
                  setCalibPhase('ready')
                  calibPhaseRef.current = 'ready'
                  earBufferRef.current = []

                  const audioSamples = audioBufferRef.current
                  const avgAudio = audioSamples.length > 0
                    ? audioSamples.reduce((a, b) => a + b, 0) / audioSamples.length
                    : 0
                  audioThresholdRef.current = Math.max(5, Math.min(40, avgAudio + 8))
                  audioBufferRef.current = []

                  setPhase('INTERVIEWING')
                  // Calibration complete — start the audio/transcript capture.
                  startCaptureRef.current?.()
                }
              } else if (calibPhaseRef.current === 'ready') {
                if (ear < earThresholdRef.current && now - lastBlinkTime > 300) {
                  blinkTotal++
                  blinkCountRef.current = blinkTotal
                  lastBlinkTime = now
                  setBlinkCount(blinkTotal)

                  setStressScore(prev => {
                    const spike = Math.min(100, prev + 8)
                    stressRef.current = spike
                    return spike
                  })
                }
              }
            }
          } catch (err) {
            console.error("Detect loop recovered from error:", err)
          }
          detectAnimId = requestAnimationFrame(detect)
        }
        detect()
      } catch (err) {
        console.warn('MediaPipe load error:', err)
      }
    }

    loadFaceMesh()
    return () => cancelAnimationFrame(detectAnimId)
  }, [cameraReady])

  useEffect(() => {
    if (phase !== 'INTERVIEWING') return
    const intervalId = setInterval(() => {
      sessionTimeRef.current += 2
      setSessionTime(sessionTimeRef.current)
      sessionDataRef.current.push({
        time: formatTime(sessionTimeRef.current),
        stress: Math.round(stressRef.current),
        blinks: blinkCountRef.current,
        audioLevel: Math.round(audioLevelRef.current),
      })
    }, 2000)
    return () => clearInterval(intervalId)
  }, [phase])


  function handleStartInterview() {
    if (startingRef.current || !cameraReady || !tier1Ready) return
    startingRef.current = true

    const sessionStartTime = performance.now()
    startSession(sessionStartTime)

    setCalibPhase('calibrating')
    calibPhaseRef.current = 'calibrating'
    calibStartRef.current = Date.now()
    setPhase('CALIBRATING')
  }

  async function handleEndSession() {
    setEndingSession(true)
    await endSession()
    setEndingSession(false)

    const data = sessionDataRef.current
    if (data.length === 0) {
      setReportData({ empty: true })
    } else {
      const avgStress = Math.round(data.reduce((s, d) => s + d.stress, 0) / data.length)
      const peakStress = data.reduce((max, d) => Math.max(max, d.stress), 0)
      const peakEntry = data.find(d => d.stress === peakStress)
      const peakTime = peakEntry?.time ?? '--:--'
      const totalBlinks = blinkCountRef.current
      const duration = formatTime(sessionTimeRef.current)
      setReportData({
        avgStress, peakStress, peakTime, totalBlinks, duration,
        sessionData: [...data],
        signalEvents: [...signalEventsRef.current],
        tier2StartOffsetMs,
      })
    }
    setPhase('REPORT')
  }

  async function handleNewSession() {
    await resetEngine()
    sessionDataRef.current = []
    sessionTimeRef.current = 0
    stressRef.current = 0
    blinkCountRef.current = 0
    lastStressUpdateRef.current = performance.now()
    lastBlinkCountRef.current = 0
    earBufferRef.current = []
    audioBufferRef.current = []
    startingRef.current = false
    calibStartRef.current = null
    calibPhaseRef.current = 'idle'
    setSessionTime(0)
    setStressScore(0)
    setBlinkCount(0)
    setAudioLevel(0)
    setCalibPhase('idle')
    setCalibProgress(0)
    setCalibBaseline(null)
    setReportData(null)
    setPhase('LOBBY')
  }

  function handleNextQuestion() {
    setQuestionIndex(i => (i + 1) % questions.length)
  }

  const borderColor = stressScore < 30 ? '#22c55e' : stressScore < 60 ? '#f59e0b' : '#ef4444'
  const borderGlow = stressScore < 30 ? '0 0 12px #22c55e55' : stressScore < 60 ? '0 0 12px #f59e0b88' : '0 0 16px #ef444488'
  const reportTimeline = reportData && !reportData.empty
    ? buildUnifiedTimeline(reportData.sessionData || [], reportData.signalEvents || [])
    : []
  const coachingCards = reportData && !reportData.empty
    ? generateCoachingCards(reportData.sessionData || [], reportData.signalEvents || [])
    : []

  function toggleReportSeries(key) {
    setHiddenReportSeries(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      {/* SINGLE SOURCE OF TRUTH VIDEO (Hidden) */}
      <video ref={videoRef} style={{ display: 'none' }} muted playsInline />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#1a1a1a', borderBottom: '1px solid #333', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: phase === 'INTERVIEWING' ? borderColor : '#555', boxShadow: phase === 'INTERVIEWING' ? borderGlow : 'none' }} />
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>CogniFlow</span>
          <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>Interview Coach</span>
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#aaa', alignItems: 'center' }}>
          {phase === 'INTERVIEWING' && <>
            <span>Blinks: <b style={{ color: '#fff' }}>{blinkCount}</b></span>
            <span>Stress: <b style={{ color: borderColor }}>{Math.round(stressScore)}%</b></span>
            <span style={{ color: '#888', fontVariantNumeric: 'tabular-nums' }}>{formatTime(sessionTime)}</span>
            <button onClick={handleEndSession} disabled={endingSession} tabIndex={-1} style={{ padding: '4px 12px', fontSize: 11, background: '#1a0000', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, cursor: endingSession ? 'not-allowed' : 'pointer' }}>
              {endingSession ? 'Processing…' : 'End Session'}
            </button>
          </>}
          {phase === 'LOBBY' && <span style={{ color: cameraReady ? '#22c55e' : '#888' }}>● {cameraReady ? 'Camera ready' : 'Loading camera...'}</span>}
          {phase === 'REPORT' && <span style={{ color: '#22c55e' }}>● Session complete</span>}
        </div>
      </div>

      {phase === 'LOBBY' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 420px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>QUESTION</div>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: 20, border: '1px solid #333' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{currentQuestion.title}</span>
                <span style={{ fontSize: 11, background: '#0a1a2e', color: '#60a5fa', border: '1px solid #1e3a5f', borderRadius: 4, padding: '2px 10px' }}>{currentQuestion.difficulty}</span>
              </div>
              <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.7, margin: 0 }}>{currentQuestion.description}</p>
            </div>
            {cameraError && (
              <div style={{ background: '#1a0000', border: '1px solid #ef4444', borderRadius: 8, padding: 12, fontSize: 12, color: '#ef4444' }}>{cameraError}</div>
            )}
            <button onClick={handleStartInterview} disabled={!cameraReady || !!cameraError || !tier1Ready}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px 0', fontSize: 15, fontWeight: 600, background: cameraReady && !cameraError && tier1Ready ? '#0D2E1A' : '#111', color: cameraReady && !cameraError && tier1Ready ? '#22c55e' : '#555', border: `1.5px solid ${cameraReady && !cameraError && tier1Ready ? '#22c55e' : '#333'}`, borderRadius: 8, cursor: cameraReady && !cameraError && tier1Ready ? 'pointer' : 'not-allowed' }}>
              {!cameraReady ? 'Loading camera...' : !tier1Ready ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #555', borderTopColor: '#aaa', animation: 'spin 1s linear infinite' }} />
                    Preparing AI models...
                  </div>
                  <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>This might take a few moments</span>
                </div>
              ) : 'Start Interview'}
            </button>
            <p style={{ fontSize: 11, color: '#555', textAlign: 'center', margin: 0 }}>A 10-second calibration will run first</p>
            <button onClick={handleNextQuestion} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer', textAlign: 'right', padding: 0 }}>
              Next question: {questions[(questionIndex + 1) % questions.length].title} →
            </button>
          </div>

          <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>HOW IT WORKS</div>
            <div style={{ fontSize: 13, color: '#aaa', lineHeight: 2 }}>
              {['Allow camera and microphone', 'Look naturally at screen during calibration', 'Code your solution', 'Click End Session when done'].map((step, i) => (
                <div key={i}><span style={{ color: '#22c55e', marginRight: 10 }}>{'①②③④'[i]}</span>{step}</div>
              ))}
            </div>
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #333', background: '#111', aspectRatio: '4/3' }}>
              <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', opacity: 0.6 }} />
              {!cameraReady && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#888' }}>Requesting camera...</div>}
            </div>
          </div>
        </div>
      )}

      {(phase === 'CALIBRATING' || phase === 'INTERVIEWING') && (
        <div className="fade-in" style={{ flex: 1, position: 'relative', display: 'flex' }}>

          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 12, padding: 12, filter: endingSession ? 'blur(8px)' : 'none', transition: 'filter 0.3s ease', pointerEvents: endingSession ? 'none' : 'auto' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#888', paddingLeft: 4 }}>CODE EDITOR</div>
              <div style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: `2px solid ${borderColor}`, boxShadow: borderGlow, transition: 'border-color 1s ease, box-shadow 1s ease', animation: 'breathe 4s ease-in-out infinite' }}>
                <Editor key={currentQuestion.id} height="100%" defaultLanguage="javascript" theme="vs-dark"
                  defaultValue={currentQuestion.starterCode}
                  options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: 'on', padding: { top: 16 } }} />
              </div>
            </div>

            <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: '#888' }}>FACE TRACKING</div>
              <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #333', background: '#111', aspectRatio: '4/3' }}>
                <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', opacity: 0.6 }} />
              </div>
              {calibBaseline && (
                <div style={{ background: '#0f2318', borderRadius: 8, padding: '8px 12px', border: '1px solid #22c55e33', fontSize: 11, color: '#22c55e' }}>
                  ✓ Baseline set — neutral EAR: {calibBaseline}<br />
                  <span style={{ color: '#666' }}>Blink threshold: {(earThresholdRef.current).toFixed(4)} (baseline × 0.70)</span><br />
                  <span style={{ color: '#666' }}>Mic threshold: {Math.round(audioThresholdRef.current)}%</span>
                </div>
              )}
              <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 12, border: '1px solid #333' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>AUDIO MODULE</div>
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>Speech activity</div>
                <div style={{ height: 8, background: '#333', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${audioLevel}%`, background: audioLevel > 60 ? '#ef4444' : '#22c55e', borderRadius: 4, transition: 'width 0.1s ease' }} />
                </div>
                <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Level: {audioLevel}%</div>
              </div>
              <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 12, border: '1px solid #333', flex: 1 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>STRESS INDEX</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: borderColor, textAlign: 'center', margin: '16px 0' }}>{Math.round(stressScore)}%</div>
                <div style={{ fontSize: 11, color: '#666', textAlign: 'center' }}>
                  {stressScore < 30 ? '● Calm — focus maintained' : stressScore < 60 ? '● Elevated — breathe slowly' : '● High — take a pause'}
                </div>
                <div style={{ marginTop: 16, height: 4, background: '#333', borderRadius: 4 }}>
                  <div style={{ height: '100%', width: `${stressScore}%`, background: borderColor, borderRadius: 4, transition: 'width 0.5s ease' }} />
                </div>
              </div>
              <div style={{ background: '#111', borderRadius: 8, padding: 10, border: '1px solid #222', fontSize: 11, color: '#666', lineHeight: 1.6 }}>
                <b style={{ color: '#888' }}>Calibration Engine</b><br />
                Scores are z-score deviations from <i>your</i> neutral baseline — not a generic average. Fairness-preserving by design.
              </div>
            </div>
          </div>

          <div className={phase === 'CALIBRATING' ? '' : 'fade-out'} style={{
            position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(15,15,15,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: phase === 'CALIBRATING' ? 'auto' : 'none'
          }}>
            <div style={{ textAlign: 'center', maxWidth: 400, padding: 32 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 22, color: '#f59e0b', animation: 'breathe 4s ease-in-out infinite' }}>◎</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Setting your personal baseline</div>
              <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.8, marginBottom: 24 }}>
                Look naturally at the screen for 10 seconds.<br />
                CogniFlow is learning your neutral eye state.<br />
                <span style={{ color: '#f59e0b' }}>All scores will be relative to <i>you</i> — not a generic average.</span>
              </div>
              <div role="progressbar" aria-label="Calibration progress" aria-valuenow={calibProgress} aria-valuemin="0" aria-valuemax="100" style={{ height: 8, background: '#333', borderRadius: 4, overflow: 'hidden', width: 320, margin: '0 auto 10px' }}>
                <div style={{ height: '100%', width: `${calibProgress}%`, background: calibProgress === 100 ? '#22c55e' : '#f59e0b', borderRadius: 4, transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ fontSize: 13, color: '#888' }}>{calibProgress}% complete</div>
            </div>
          </div>

          {endingSession && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(15,15,15,0.6)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
            }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid #333', borderTopColor: '#22c55e', animation: 'spin 1s linear infinite', marginBottom: 16 }} />
              <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Processing Session Data...</div>
              <div style={{ fontSize: 13, color: '#aaa', marginTop: 8 }}>Analyzing behavior and generating report</div>
            </div>
          )}

        </div>
      )}

      {phase === 'REPORT' && reportData && (
        <div className="fade-in" style={{ flex: 1, overflow: 'auto', padding: 32 }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ marginBottom: 8, fontSize: 11, color: '#888', letterSpacing: 1 }}>SESSION COMPLETE — {currentQuestion.title.toUpperCase()}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Your session report</div>

            {reportData.empty ? (
              <div style={{ background: '#1a1a1a', borderRadius: 10, padding: 32, textAlign: 'center', color: '#888', fontSize: 14 }}>
                Session ended too quickly — no data to display.<br />
                <span style={{ fontSize: 12, color: '#555' }}>Complete at least 10 seconds of the interview to generate a report.</span>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
                  {[
                    { label: 'Avg stress', value: `${reportData.avgStress}%`, color: reportData.avgStress < 40 ? '#22c55e' : reportData.avgStress < 70 ? '#f59e0b' : '#ef4444' },
                    { label: 'Peak stress', value: `${reportData.peakStress}%`, sub: `at ${reportData.peakTime}`, color: '#f59e0b' },
                    { label: 'Blinks', value: reportData.totalBlinks, color: '#fff' },
                    { label: 'Duration', value: reportData.duration, color: '#fff' },
                  ].map((card, i) => (
                    <div key={i} style={{ background: '#1a1a1a', borderRadius: 10, padding: 16, border: '1px solid #333', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>{card.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</div>
                      {card.sub && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{card.sub}</div>}
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 11, color: '#888', letterSpacing: 1, marginBottom: 10 }}>UNIFIED BEHAVIORAL TIMELINE</div>
                  <div style={{ background: '#1a1a1a', borderRadius: 8, border: '1px solid #333', padding: '16px 18px 14px 0' }}>
                    <ResponsiveContainer width="100%" height={244}>
                      <ComposedChart data={reportTimeline} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis
                          dataKey="seconds"
                          type="number"
                          stroke="#666"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={value => formatTime(Math.round(value))}
                        />
                        <YAxis
                          yAxisId="percent"
                          stroke="#666"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 100]}
                          tickFormatter={value => `${value}%`}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line yAxisId="percent" name="Stress" type="monotone" dataKey="stress" stroke="#d2a630" strokeWidth={2.8} dot={false} hide={hiddenReportSeries.stress} connectNulls activeDot={{ r: 5, fill: '#d2a630', stroke: '#111', strokeWidth: 2 }} />
                        <Line yAxisId="percent" name="Smile" type="monotone" dataKey="smile" stroke="#3fb950" strokeWidth={2} dot={false} hide={hiddenReportSeries.smile} connectNulls strokeOpacity={0.9} />
                        <Line yAxisId="percent" name="Tension" type="monotone" dataKey="facialTension" stroke="#a371f7" strokeWidth={1.8} strokeDasharray="5 3" dot={false} hide={hiddenReportSeries.facialTension} connectNulls strokeOpacity={0.75} />
                        <Line yAxisId="percent" name="Fear" type="monotone" dataKey="fear" stroke="#f85149" strokeWidth={1.4} dot={false} hide={hiddenReportSeries.fear} connectNulls strokeOpacity={0.5} />
                        <Line yAxisId="percent" name="Anger" type="monotone" dataKey="anger" stroke="#ff7b72" strokeWidth={1.4} dot={false} hide={hiddenReportSeries.anger} connectNulls strokeOpacity={0.5} />
                        <Line yAxisId="percent" name="Contempt" type="monotone" dataKey="contempt" stroke="#79c0ff" strokeWidth={1.4} dot={false} hide={hiddenReportSeries.contempt} connectNulls strokeOpacity={0.5} />
                        <Line yAxisId="percent" name="Audio" type="monotone" dataKey="audio" stroke="#58a6ff" strokeWidth={1.4} strokeDasharray="2 2" dot={false} hide={hiddenReportSeries.audio} connectNulls strokeOpacity={0.55} />
                        <Scatter yAxisId="percent" name="Pause" dataKey="pauseMarker" fill="#fbbf24" shape="circle" legendType="none" fillOpacity={0.75} />
                        <Scatter yAxisId="percent" name="Rush" dataKey="rushMarker" fill="#38bdf8" shape="circle" legendType="none" fillOpacity={0.75} />
                        <Scatter yAxisId="percent" name="Freeze" dataKey="freezeMarker" fill="#ef4444" shape="circle" legendType="none" fillOpacity={0.75} />
                        <Scatter yAxisId="percent" name="Disfluency" dataKey="disfluencyMarker" fill="#22c55e" shape="circle" legendType="none" fillOpacity={0.75} />
                        <Scatter yAxisId="percent" name="Tense Disfluency" dataKey="tenseDisfluencyMarker" fill="#ec4899" shape="circle" legendType="none" fillOpacity={0.75} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 18px 0 28px', alignItems: 'center' }}>
                      {REPORT_SERIES.map(series => {
                        const hidden = hiddenReportSeries[series.key]
                        return (
                          <button
                            key={series.key}
                            type="button"
                            onClick={() => toggleReportSeries(series.key)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '4px 9px',
                              borderRadius: 6,
                              border: `1px solid ${hidden ? '#333' : series.color}`,
                              background: hidden ? '#111' : '#151515',
                              color: hidden ? '#666' : '#ddd',
                              fontSize: 11,
                              cursor: 'pointer',
                              opacity: hidden ? 0.7 : 1,
                            }}
                          >
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: series.color, opacity: hidden ? 0.35 : 1 }} />
                            {series.label}
                          </button>
                        )
                      })}
                      <span style={{ marginLeft: 'auto', color: '#666', fontSize: 10 }}>
                        Event dots sit in the bottom band
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 32 }}>
                  <div style={{ fontSize: 11, color: '#888', letterSpacing: 1, marginBottom: 10 }}>NEXT ATTEMPT COACHING</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {coachingCards.map(card => (
                      <div key={card.title} style={{ background: '#1a1a1a', borderRadius: 8, padding: 16, border: '1px solid #333' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10 }}>{card.title}</div>
                        {[
                          ['Detected', card.detected],
                          ['Meaning', card.meaning],
                          ['Strategy', card.strategy],
                          ['Practice', card.practice],
                        ].map(([label, value]) => (
                          <div key={label} style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10, color: '#777', letterSpacing: 0.8, marginBottom: 3 }}>{label.toUpperCase()}</div>
                            <div style={{ fontSize: 12, color: '#ddd', lineHeight: 1.55 }}>{value}</div>
                          </div>
                        ))}
                        <a href={card.resourceUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontSize: 12, textDecoration: 'none' }}>
                          {card.youtubeQuery}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 32 }}>
                  <div style={{ fontSize: 11, color: '#888', letterSpacing: 1, marginBottom: 10 }}>REFLECTION PROMPTS</div>
                  {[
                    `Your stress was elevated at ${reportData.peakTime}. What were you thinking about at that moment?`,
                    'What would you do differently if you attempted this problem again?',
                  ].map((prompt, i) => (
                    <div key={i} style={{ padding: '12px 16px', background: '#1a1a1a', borderLeft: '3px solid #3b82f6', marginBottom: 10, fontSize: 13, color: '#ddd', lineHeight: 1.6 }}>
                      {prompt}
                    </div>
                  ))}
                </div>
              </>
            )}

            <button onClick={handleNewSession} style={{ width: '100%', padding: '14px 0', fontSize: 14, fontWeight: 600, background: '#0D2E1A', color: '#22c55e', border: '1.5px solid #22c55e', borderRadius: 8, cursor: 'pointer' }}>
              Start New Session
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.85; } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
