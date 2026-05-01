# CogniFlow — Failproof Scenarios & Edge Cases

## Overview

This document covers every scenario where something can go wrong across the fully implemented React architecture (Weeks 1-6). For each scenario it describes what the failure looks like, why it happens, and exactly how it is safely handled to ensure stable User Studies in Weeks 7-10.

---

## 1. Camera and Microphone Failures

### Scenario: User denies camera or mic permission

**What happens:** `getUserMedia()` throws a `NotAllowedError`. Without handling this, the app hangs silently on the lobby screen with nothing working.

**Fix:** Wrap `getUserMedia` in a try/catch and show a clear message:

```js
try {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
} catch (err) {
  if (err.name === 'NotAllowedError') {
    setCameraError('Camera and microphone access is required. Please allow access and refresh.')
  }
}
```

Show `cameraError` as a banner on the lobby screen before the Start button becomes active.

---

### Scenario: User has no webcam

**What happens:** `getUserMedia` throws `NotFoundError`. App crashes silently.

**Fix:** Same catch block as above. Set a different message:
```
'No camera detected. CogniFlow requires a webcam to run.'
```

Disable the Start Interview button if `cameraError` is set.

---

### Scenario: User closes their laptop mid-session (camera stream ends)

**What happens:** MediaPipe keeps running its detect loop but gets no new frames. `video.readyState` drops below 2. The detect loop spins forever doing nothing.

**Fix:** Already handled — your detect loop has:
```js
if (!video || video.readyState < 2) {
  detectAnimId = requestAnimationFrame(detect)
  return
}
```
This gracefully skips frames without crashing. No additional fix needed.

---

## 2. Calibration Failures

### Scenario: User clicks Start Interview before the camera is ready

**What happens:** Calibration starts but the video feed has no frames yet. EAR buffer fills with zeros. avgEAR = 0. Threshold = 0. Every blink triggers immediately and the blink counter skyrockets.

**Fix:** Disable the Start Interview button until `cameraReady === true`:
```jsx
<button disabled={!cameraReady} onClick={handleStart}>
  {cameraReady ? 'Start Interview' : 'Loading camera...'}
</button>
```

---

### Scenario: User looks away during calibration

**What happens:** No face detected. EAR buffer gets no samples for those frames. If the buffer is sparse, avgEAR is unreliable.

**Fix:** Only push to `earBufferRef` when a face is actually detected:
```js
if (results.faceLandmarks?.length > 0) {
  earBufferRef.current.push(ear)
}
```
This is already how your code works — the push only happens inside the face detection block. No additional fix needed.

---

### Scenario: Calibration buffer is empty when time runs out

**What happens:** User had their face off camera for the full 90 seconds. `earBufferRef.current` is empty. `avgEAR` becomes `NaN`. Threshold is `NaN`. Nothing works.

**Fix:** Add a guard before computing the threshold:
```js
const samples = earBufferRef.current
if (samples.length === 0) {
  earThresholdRef.current = 0.015 // fallback to safe default
} else {
  const avgEar = samples.reduce((a, b) => a + b, 0) / samples.length
  earThresholdRef.current = avgEar * 0.70
}
```

---

## 3. Session Lifecycle State Failures

### Scenario: User clicks Start Interview multiple times rapidly

**What happens:** Multiple calibration timers start simultaneously. `calibStartRef.current` gets overwritten. Progress bar jumps around. Phase transitions happen twice.

**Fix:** Disable the Start button immediately after the first click:
```js
const [starting, setStarting] = useState(false)

function handleStart() {
  if (starting) return
  setStarting(true)
  setPhase('CALIBRATING')
  calibPhaseRef.current = 'calibrating'
  calibStartRef.current = Date.now()
}
```

---

### Scenario: User clicks End Session before any data is logged

**What happens:** `sessionDataRef.current` is empty. The report card tries to calculate `Math.max(...[])` which returns `-Infinity`. Average of empty array returns `NaN`. The UI shows broken values.

**Fix:** Guard all calculations:
```js
const data = sessionDataRef.current
if (data.length === 0) {
  // Show a "Session too short" message instead of the report card
  return <p>Session ended too quickly. No data to display.</p>
}
```

---

### Scenario: User tries to refresh the page mid-session

**What happens:** All React state is lost. The app reloads to LOBBY. Session data is gone.

**This is expected behavior.** Do not try to persist session data across refreshes for this prototype. Just make sure the camera stream cleanup runs correctly on unmount so the browser releases the camera. Your existing cleanup in `useEffect` already handles this:
```js
return () => {
  if (streamRef.current) {
    streamRef.current.getTracks().forEach(track => track.stop())
  }
}
```

---

## 4. Session Data Logging Failures

### Scenario: Stale closure in the logging interval

**What happens:** The `setInterval` inside `useEffect` captures the initial value of `stressScore` (0) and never sees updated values. Every snapshot logs `stress: 0`.

**Fix:** Use refs instead of state values inside the interval:
```js
const stressRef = useRef(0)

// Keep ref in sync whenever state updates
useEffect(() => { stressRef.current = stressScore }, [stressScore])

// Inside the logging interval, read from ref not state
sessionDataRef.current.push({
  stress: Math.round(stressRef.current),
  // ...
})
```

---

### Scenario: Session timer and logging interval get out of sync

**What happens:** Two separate intervals running at different rates drift apart. The time displayed in the header does not match the timestamps in the session data.

**Fix:** Use a single source of truth. Drive both the display timer and the logging from the same ref:
```js
const sessionTimeRef = useRef(0)

// One interval does both jobs
const loggingInterval = setInterval(() => {
  sessionTimeRef.current += 2
  setSessionTime(sessionTimeRef.current) // update display
  
  sessionDataRef.current.push({
    time: formatTime(sessionTimeRef.current),
    stress: Math.round(stressRef.current),
    blinks: blinkCountRef.current,
    audioLevel: Math.round(audioLevelRef.current)
  })
}, 2000)
```

---

## 5. Report Card Failures

### Scenario: `Math.max(...sessionData.map(...))` throws a stack overflow

**What happens:** If the session is very long (1000+ data points), spreading a large array into `Math.max()` can hit JavaScript's call stack limit.

**Fix:** Use `reduce` instead:
```js
const peakStress = sessionData.reduce((max, d) => Math.max(max, d.stress), 0)
```

---

### Scenario: Start New Session button does not fully reset

**What happens:** User clicks Start New Session but residual state from the old session bleeds into the new one. Blink count starts at 148 instead of 0. Stress starts at 67 instead of 0.

**Fix:** Reset everything explicitly:
```js
function handleNewSession() {
  sessionDataRef.current = []
  sessionTimeRef.current = 0
  stressRef.current = 0
  blinkCountRef.current = 0
  earBufferRef.current = []
  setSessionTime(0)
  setStressScore(0)
  setBlinkCount(0)
  setAudioLevel(0)
  setCalibPhase('idle')
  calibPhaseRef.current = 'idle'
  setCalibProgress(0)
  setCalibBaseline(null)
  setStarting(false)
  setPhase('LOBBY')
}
```

---

## 6. Monaco Editor Failures

### Scenario: Question changes but Monaco Editor still shows old code

**What happens:** Monaco Editor's `defaultValue` prop only sets the initial content. Changing the question index does not update the editor because React does not re-render the editor content for prop changes after mount.

**Fix:** Use Monaco's `key` prop to force a remount when the question changes:
```jsx
<Editor
  key={currentQuestion.id}
  defaultValue={currentQuestion.starterCode}
  // ...other props
/>
```

When `key` changes, React unmounts and remounts the component fresh with the new starter code.

---

## 7. Performance Failures

### Scenario: Frame drops when logging + face tracking run simultaneously

**What happens:** MediaPipe detect loop runs on every animation frame (~60fps). Adding a 2-second interval on top of that for logging is fine on its own, but if the logging callback does heavy computation it can cause jank.

**Fix:** Keep the logging callback lightweight — only push a pre-computed snapshot object. Never compute averages or do array operations inside the interval. Do all that computation once when the report card renders.

---

### Scenario: Memory leak from uncleaned intervals

**What happens:** If `useEffect` cleanup does not cancel all intervals, they keep running after the component unmounts or the phase changes. Multiple overlapping intervals cause duplicate log entries and drift.

**Fix:** Always return a cleanup function from every `useEffect` that creates an interval:
```js
useEffect(() => {
  if (phase !== 'INTERVIEWING') return
  const id = setInterval(() => { /* ... */ }, 2000)
  return () => clearInterval(id)
}, [phase])
```

---

## 8. Week 6 Feature Failures

### Scenario: Recharts throws an error if `sessionData` is missing or malformed

**What happens:** When the session ends, if `reportData.sessionData` isn't passed correctly into `<LineChart data={...}>`, Recharts crashes the entire `App` component with an unhandled runtime exception.

**Fix:** Ensure that `setReportData` includes a destructured copy or explicit reference to the data array, and that `data.length > 0` guard in `handleEndSession` continues to prevent rendering an empty chart:
```js
setReportData({ avgStress, peakStress, peakTime, totalBlinks, duration, sessionData: [...data] })
```

---

### Scenario: Stress Fusion algorithm causes `stressScore` to exceed 100% or drop below 0%

**What happens:** Blinking rapidly while speaking loudly causes the addition formula (`prev + 8`) to push `stressRef.current` strictly over 100. Recharts attempts to scale the Y-axis beyond the normalized `domain={[0, 100]}`, stretching the plot awkwardly.

**Fix:** Strictly bound the mathematical inputs during state assignment to guarantee it never breaches normalized values:
```js
setStressScore(prev => {
  const spike = Math.min(100, prev + 8)
  stressRef.current = spike
  return spike
})
```

---

## Quick Reference: What to Test Before Submitting

| Test | Expected result |
|---|---|
| Open app — is the lobby showing? | Yes, camera starts but interview has not started |
| Click Start with camera denied | Error message shown, button disabled |
| Click Start with camera allowed | Calibration overlay appears |
| Look away during calibration | Calibration continues, falls back to default threshold |
| Wait for calibration to finish | Phase moves to INTERVIEWING, timer starts at 00:00 |
| Speak loudly for 10 seconds | Stress score rises, border shifts to amber |
| Go quiet | Stress score falls back slowly |
| Click End Session immediately | Report card shows "session too short" message |
| Complete a 30 second session | Report card shows avg stress, peak, blinks, duration |
| Click Start New Session | All values reset, lobby appears |
| Cycle through questions | Each question loads correct starter code in editor |
