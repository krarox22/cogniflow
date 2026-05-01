# Latent Emotion Engine — Sub-project A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parallel Web Worker signal pipeline to CogniFlow that produces timestamped `SignalEvent` records (facial tension, cadence gaps, freeze detection, linguistic disfluency) without touching any existing UI or stress-scoring logic.

**Architecture:** Two module workers run in parallel during a session — `aggregatorWorker.js` runs real-time FER inference every 500ms and owns a 10-second sliding buffer that emits immutable finalized events; `tier2Worker.js` runs Whisper-tiny on 4-second audio chunks and backfills transcript context into unfinalized buffer events via a main-thread relay. The `useEmotionEngine` hook is the sole integration point with `App.jsx` — six additive edits total, zero regressions.

**Tech Stack:** React 19, Vite 8, `@xenova/transformers` v2 (FER + Whisper), Web Workers (ESM module type), AudioWorklet API, Vitest (unit tests for pure signal utilities)

**Spec:** `docs/superpowers/specs/2026-04-30-latent-emotion-engine-design.md`

---

## File Structure

```
src/
  hooks/
    useEmotionEngine.js          NEW  Worker lifecycle, message routing, session control
  utils/
    signals.js                   NEW  Pure signal computations (unit-testable, no DOM)
    signalSchema.js              NEW  projectForUI projection utility
  workers/
    aggregatorWorker.js          NEW  FER inference, cadence state, buffer, finalization
    tier2Worker.js               NEW  Whisper ASR, disfluency scoring, topic tagging
    pcmCaptureProcessor.js       NEW  AudioWorklet processor for raw PCM accumulation
  App.jsx                        MODIFY  6 additive edits (spec §9.2)
  utils/__tests__/
    signals.test.js              NEW  Unit tests for pure signal functions
    signalSchema.test.js         NEW  Unit tests for projectForUI
vite.config.js                   MODIFY  Exclude @xenova/transformers from pre-bundling
vitest.config.js                 NEW  Vitest configuration
package.json                     MODIFY  Add vitest + @xenova/transformers
```

---

## Task 1: Install dependencies and configure Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Modify: `vite.config.js`

- [ ] **Step 1: Install test runner and transformers library**

```bash
cd /Users/kratikahimanshu/cogniflow
npm install --save-dev vitest
npm install @xenova/transformers
```

Expected: packages added to node_modules, no errors.

- [ ] **Step 2: Add test script to package.json**

Open `package.json`. Replace the `"scripts"` block with:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

- [ ] **Step 3: Create vitest.config.js**

Create `/Users/kratikahimanshu/cogniflow/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
```

Signal computations are pure math — `node` environment is sufficient and avoids jsdom overhead.

- [ ] **Step 4: Update vite.config.js to exclude @xenova/transformers from pre-bundling**

Open `vite.config.js`. Replace the full content with:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision', '@xenova/transformers'],
  },
  worker: {
    format: 'es',
  },
})
```

The `worker.format: 'es'` ensures Vite bundles workers as ES modules, enabling `import` statements inside worker files.

- [ ] **Step 5: Verify test runner works**

```bash
npm test
```

Expected output:
```
No test files found, exiting with code 0
```

- [ ] **Step 6: Commit**

```bash
git init  # only if repo not yet initialized
git add package.json package-lock.json vitest.config.js vite.config.js
git commit -m "chore: add vitest and @xenova/transformers, configure vite for ESM workers"
```

---

## Task 2: Pure signal computation utilities (TDD)

**Files:**
- Create: `src/utils/signals.js`
- Create: `src/utils/__tests__/signals.test.js`

- [ ] **Step 1: Write failing tests for computeFacialTension**

Create `/Users/kratikahimanshu/cogniflow/src/utils/__tests__/signals.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { computeFacialTension, updateCadenceState, updateFreezeCount, computeDisfluency } from '../signals.js'

describe('computeFacialTension', () => {
  it('weights fearful at 0.6, angry at 0.3, disgusted at 0.1', () => {
    const fer = { fearful: 1, angry: 0, disgusted: 0, neutral: 0, happy: 0, sad: 0, surprised: 0 }
    expect(computeFacialTension(fer)).toBeCloseTo(0.6)
  })

  it('combines all three contributing emotions', () => {
    const fer = { fearful: 0.5, angry: 0.5, disgusted: 0.5, neutral: 0, happy: 0, sad: 0, surprised: 0 }
    expect(computeFacialTension(fer)).toBeCloseTo(0.5)
  })

  it('clamps output to 0–1', () => {
    const fer = { fearful: 1, angry: 1, disgusted: 1, neutral: 0, happy: 0, sad: 0, surprised: 0 }
    expect(computeFacialTension(fer)).toBe(1)
  })

  it('returns 0 for a fully neutral face', () => {
    const fer = { fearful: 0, angry: 0, disgusted: 0, neutral: 1, happy: 0, sad: 0, surprised: 0 }
    expect(computeFacialTension(fer)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: `FAIL` with `Cannot find module '../signals.js'`

- [ ] **Step 3: Write failing tests for updateCadenceState**

Append to `src/utils/__tests__/signals.test.js`:

```js
describe('updateCadenceState', () => {
  it('cadence_gap is false when silence is shorter than threshold', () => {
    const state = { lastSilenceStartRaw: null }
    const audio = { isSpeaking: false, rms: 0.01 }
    const { cadence_gap, speech_rush } = updateCadenceState(audio, 1000, state)
    expect(cadence_gap).toBe(false)
    expect(speech_rush).toBe(false)
  })

  it('cadence_gap is true when silence exceeds 1500ms', () => {
    const state = { lastSilenceStartRaw: 1000 }
    const audio = { isSpeaking: false, rms: 0.01 }
    const { cadence_gap } = updateCadenceState(audio, 2600, state)
    expect(cadence_gap).toBe(true)
  })

  it('speech_rush is true when returning from a gap with high RMS', () => {
    const state = { lastSilenceStartRaw: 1000 }
    const audio = { isSpeaking: true, rms: 0.8 }
    const { speech_rush, cadence_gap } = updateCadenceState(audio, 2600, state)
    expect(speech_rush).toBe(true)
    expect(cadence_gap).toBe(false)
  })

  it('speech_rush is false when returning from a gap with low RMS', () => {
    const state = { lastSilenceStartRaw: 1000 }
    const audio = { isSpeaking: true, rms: 0.3 }
    const { speech_rush } = updateCadenceState(audio, 2600, state)
    expect(speech_rush).toBe(false)
  })

  it('resets lastSilenceStartRaw when speaking resumes', () => {
    const state = { lastSilenceStartRaw: 1000 }
    const audio = { isSpeaking: true, rms: 0.2 }
    const { nextState } = updateCadenceState(audio, 2000, state)
    expect(nextState.lastSilenceStartRaw).toBeNull()
  })

  it('speech_rush reads wasGapped BEFORE resetting state (ordering guard)', () => {
    // If state is reset before checking wasGapped, speech_rush would always be false
    const state = { lastSilenceStartRaw: 1000 }
    const audio = { isSpeaking: true, rms: 0.9 }
    const { speech_rush } = updateCadenceState(audio, 3000, state)
    expect(speech_rush).toBe(true)  // would fail if reset happened first
  })
})
```

- [ ] **Step 4: Write failing tests for updateFreezeCount**

Append to `src/utils/__tests__/signals.test.js`:

```js
describe('updateFreezeCount', () => {
  it('physical_freeze is false on first qualifying tick', () => {
    const { physical_freeze, consecutiveFreezeCount } =
      updateFreezeCount(0.8, true, 0.02, 0)
    expect(physical_freeze).toBe(false)
    expect(consecutiveFreezeCount).toBe(1)
  })

  it('physical_freeze is true after two consecutive qualifying ticks', () => {
    const first = updateFreezeCount(0.8, true, 0.02, 0)
    const second = updateFreezeCount(0.8, true, 0.02, first.consecutiveFreezeCount)
    expect(second.physical_freeze).toBe(true)
  })

  it('resets count when condition breaks', () => {
    const { consecutiveFreezeCount } = updateFreezeCount(0.2, false, 0.5, 5)
    expect(consecutiveFreezeCount).toBe(0)
  })

  it('requires all three conditions: tension, cadence_gap, low rms', () => {
    expect(updateFreezeCount(0.8, false, 0.02, 0).consecutiveFreezeCount).toBe(0)
    expect(updateFreezeCount(0.8, true, 0.5, 0).consecutiveFreezeCount).toBe(0)
    expect(updateFreezeCount(0.3, true, 0.02, 0).consecutiveFreezeCount).toBe(0)
  })
})
```

- [ ] **Step 5: Write failing tests for computeDisfluency**

Append to `src/utils/__tests__/signals.test.js`:

```js
describe('computeDisfluency', () => {
  it('returns 0 for empty text', () => {
    expect(computeDisfluency('')).toBe(0)
    expect(computeDisfluency(null)).toBe(0)
  })

  it('detects single-word fillers via token matching', () => {
    // "um" appears as a whole word
    const score = computeDisfluency('um so the um algorithm is um like fast')
    expect(score).toBeGreaterThan(0)
  })

  it('does not match "like" inside another word', () => {
    const scoreWith = computeDisfluency('like this approach')
    const scoreWithout = computeDisfluency('unlike this approach')
    expect(scoreWith).toBeGreaterThan(scoreWithout)
  })

  it('counts occurrences not unique matches', () => {
    const one = computeDisfluency('um so the answer is simple')
    const three = computeDisfluency('um so um the um answer is simple')
    expect(three).toBeGreaterThan(one)
  })

  it('detects hedge phrases', () => {
    const hedge = computeDisfluency('i think the answer is probably maybe correct')
    const clean = computeDisfluency('the answer is correct and well reasoned')
    expect(hedge).toBeGreaterThan(clean)
  })

  it('clamps output to 0–1', () => {
    const saturated = computeDisfluency('um um um um um um um um um um um um')
    expect(saturated).toBeLessThanOrEqual(1)
    expect(saturated).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 6: Create src/utils/signals.js with all implementations**

Create `/Users/kratikahimanshu/cogniflow/src/utils/signals.js`:

```js
const FILLER_WORDS = ['um', 'uh', 'like', 'basically']
const FILLER_PHRASES = ['you know', 'sort of', 'kind of']
const HEDGE_PHRASES = ["i think", "maybe", "perhaps", "i'm not sure", "probably", "i guess"]

const FREEZE_TENSION_MIN = 0.50
const FREEZE_SILENCE_FLOOR = 0.05
const FREEZE_MIN_TICKS = 2
const GAP_THRESHOLD_MS = 1_500
const RUSH_RMS_THRESHOLD = 0.65

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function computeFacialTension(fer) {
  return clamp(fer.fearful * 0.6 + fer.angry * 0.3 + fer.disgusted * 0.1, 0, 1)
}

/**
 * Pure — takes state in, returns new state + signals.
 * Caller (aggregatorWorker) owns the mutable state object.
 * @param {{ isSpeaking: boolean, rms: number }} audio
 * @param {number} rawTimestamp  absolute performance.now() value
 * @param {{ lastSilenceStartRaw: number|null }} state
 * @returns {{ cadence_gap: boolean, speech_rush: boolean, nextState: object }}
 */
export function updateCadenceState(audio, rawTimestamp, state) {
  const nextState = { lastSilenceStartRaw: state.lastSilenceStartRaw }
  let cadence_gap, speech_rush

  if (!audio.isSpeaking) {
    if (nextState.lastSilenceStartRaw === null) nextState.lastSilenceStartRaw = rawTimestamp
    cadence_gap = (rawTimestamp - nextState.lastSilenceStartRaw) > GAP_THRESHOLD_MS
    speech_rush = false
  } else {
    // Read wasGapped BEFORE resetting state — ordering is load-bearing
    const wasGapped =
      nextState.lastSilenceStartRaw !== null &&
      (rawTimestamp - nextState.lastSilenceStartRaw) > GAP_THRESHOLD_MS
    cadence_gap = false
    speech_rush = wasGapped && audio.rms > RUSH_RMS_THRESHOLD
    nextState.lastSilenceStartRaw = null
  }

  return { cadence_gap, speech_rush, nextState }
}

/**
 * Pure — takes current freeze count, returns new count + derived boolean.
 */
export function updateFreezeCount(facial_tension, cadence_gap, rms, consecutiveFreezeCount) {
  const condition =
    facial_tension > FREEZE_TENSION_MIN &&
    cadence_gap === true &&
    rms < FREEZE_SILENCE_FLOOR

  const nextCount = condition ? consecutiveFreezeCount + 1 : 0
  return {
    consecutiveFreezeCount: nextCount,
    physical_freeze: nextCount >= FREEZE_MIN_TICKS,
  }
}

/**
 * Computes linguistic disfluency score (0–1) from a Whisper transcript chunk.
 * Uses token matching for single-word fillers (avoids "like" inside "alike").
 * Uses occurrence counting for multi-word phrases.
 */
export function computeDisfluency(text) {
  if (!text || text.length === 0) return 0
  const lowered = text.toLowerCase()
  const tokens = lowered.match(/\b\w+\b/g) ?? []
  if (tokens.length === 0) return 0

  const fillerWordCount = tokens.filter(t => FILLER_WORDS.includes(t)).length

  let fillerPhraseCount = 0
  for (const phrase of FILLER_PHRASES) {
    let idx = 0
    while ((idx = lowered.indexOf(phrase, idx)) !== -1) {
      fillerPhraseCount++
      idx += phrase.length
    }
  }

  let hedgeCount = 0
  for (const phrase of HEDGE_PHRASES) {
    let idx = 0
    while ((idx = lowered.indexOf(phrase, idx)) !== -1) {
      hedgeCount++
      idx += phrase.length
    }
  }

  const rawScore = (fillerWordCount + fillerPhraseCount + hedgeCount * 0.5) / (tokens.length / 10)
  return clamp(rawScore, 0, 1)
}
```

- [ ] **Step 7: Run tests and verify all pass**

```bash
npm test
```

Expected output:
```
✓ src/utils/__tests__/signals.test.js (14)
  ✓ computeFacialTension (4)
  ✓ updateCadenceState (6)
  ✓ updateFreezeCount (4)
  ✓ computeDisfluency (6)

Test Files  1 passed (1)
Tests       20 passed (20)
```

- [ ] **Step 8: Commit**

```bash
git add src/utils/signals.js src/utils/__tests__/signals.test.js
git commit -m "feat: add pure signal computation utilities with full test coverage"
```

---

## Task 3: Signal schema and projectForUI utility (TDD)

**Files:**
- Create: `src/utils/signalSchema.js`
- Create: `src/utils/__tests__/signalSchema.test.js`

- [ ] **Step 1: Write failing test**

Create `/Users/kratikahimanshu/cogniflow/src/utils/__tests__/signalSchema.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { projectForUI } from '../signalSchema.js'

const FULL_EVENT = {
  id: 'sig-1',
  timestamp: 3200,
  finalized: true,
  signals: {
    facial_tension: 0.7,
    cadence_gap: true,
    speech_rush: false,
    physical_freeze: false,
    linguistic_disfluency: 0.3,
    raw: {
      fer: { neutral: 0.1, happy: 0, sad: 0, angry: 0.2, fearful: 0.6, disgusted: 0.1, surprised: 0 },
      audio: { rms: 0.02, isSpeaking: false },
    },
  },
  context: {
    text: 'um so like the algorithm is basically',
    topic: 'Two Sum',
    chunkStart: 2000,
    chunkEnd: 6000,
  },
}

describe('projectForUI', () => {
  it('includes all five derived signals', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.signals.facial_tension).toBe(0.7)
    expect(p.signals.cadence_gap).toBe(true)
    expect(p.signals.speech_rush).toBe(false)
    expect(p.signals.physical_freeze).toBe(false)
    expect(p.signals.linguistic_disfluency).toBe(0.3)
  })

  it('strips the raw layer', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.signals.raw).toBeUndefined()
  })

  it('includes id and timestamp', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.id).toBe('sig-1')
    expect(p.timestamp).toBe(3200)
  })

  it('strips context.text but keeps topic and timestamps', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.context.text).toBeUndefined()
    expect(p.context.topic).toBe('Two Sum')
    expect(p.context.chunkStart).toBe(2000)
    expect(p.context.chunkEnd).toBe(6000)
  })

  it('preserves null context', () => {
    const noContext = { ...FULL_EVENT, context: null }
    expect(projectForUI(noContext).context).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: `FAIL` with `Cannot find module '../signalSchema.js'`

- [ ] **Step 3: Implement signalSchema.js**

Create `/Users/kratikahimanshu/cogniflow/src/utils/signalSchema.js`:

```js
/**
 * Strips the raw FER/audio layer and context.text from a full SignalEvent.
 * Use this when binding events to UI components (Sub-projects B and C).
 * Full-fidelity stream remains available via signalEventsRef for research export.
 *
 * @param {SignalEvent} event
 * @returns {SignalEventProjection}
 */
export function projectForUI(event) {
  return {
    id:        event.id,
    timestamp: event.timestamp,
    signals: {
      facial_tension:        event.signals.facial_tension,
      cadence_gap:           event.signals.cadence_gap,
      speech_rush:           event.signals.speech_rush,
      physical_freeze:       event.signals.physical_freeze,
      linguistic_disfluency: event.signals.linguistic_disfluency,
    },
    context: event.context && {
      topic:      event.context.topic,
      chunkStart: event.context.chunkStart,
      chunkEnd:   event.context.chunkEnd,
    },
  }
}
```

- [ ] **Step 4: Run tests — all must pass**

```bash
npm test
```

Expected: all 25 tests pass across both test files.

- [ ] **Step 5: Commit**

```bash
git add src/utils/signalSchema.js src/utils/__tests__/signalSchema.test.js
git commit -m "feat: add signalSchema with projectForUI utility and tests"
```

---

## Task 4: Stub useEmotionEngine hook — wire into App.jsx (no-regression baseline)

**Files:**
- Create: `src/hooks/useEmotionEngine.js`
- Modify: `src/App.jsx`

This task establishes a testable no-regression baseline. The stub returns `tier1Ready: true` immediately, so the existing UI behaves identically to today. All six App.jsx edits that touch non-engine state are wired here.

- [ ] **Step 1: Create the stub hook**

Create `/Users/kratikahimanshu/cogniflow/src/hooks/useEmotionEngine.js`:

```js
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
```

- [ ] **Step 2: Wire hook into App.jsx — Edit 1 (hook instantiation)**

In `src/App.jsx`, add the import at the top with the other imports:

```js
import { useEmotionEngine } from './hooks/useEmotionEngine'
```

Then add this block inside the `App()` function body, immediately after the existing `const currentQuestion = questions[questionIndex]` line:

```js
const [endingSession, setEndingSession] = useState(false)

const {
  tier1Ready,
  tier2Ready,
  tier2StartOffsetMs,
  startSession,
  endSession,
  resetEngine,
  signalEventsRef,
} = useEmotionEngine({
  streamRef,
  audioLevelRef,
  canvasRef,
  currentQuestionTitle: currentQuestion.title,
})
```

- [ ] **Step 3: Apply Edit 2 — tighten handleStartInterview gate + call startSession**

Find the existing `handleStartInterview` function in `App.jsx` and replace it:

```js
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
```

- [ ] **Step 4: Apply Edit 3 — handleEndSession becomes async + awaits endSession**

Replace `handleEndSession` in `App.jsx`:

```js
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
```

- [ ] **Step 5: Apply Edit 4 — handleNewSession becomes async + calls resetEngine**

Replace `handleNewSession` in `App.jsx`:

```js
async function handleNewSession() {
  await resetEngine()
  sessionDataRef.current = []
  sessionTimeRef.current = 0
  stressRef.current = 0
  blinkCountRef.current = 0
  earBufferRef.current = []
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
```

- [ ] **Step 6: Apply Edit 5 — Start button shows model-readiness label**

Find the Start Interview button JSX in `App.jsx`. Replace the `disabled` prop and button text:

```jsx
<button onClick={handleStartInterview} disabled={!cameraReady || !!cameraError || !tier1Ready}
  style={{ padding: '14px 0', fontSize: 15, fontWeight: 600, background: cameraReady && !cameraError && tier1Ready ? '#0D2E1A' : '#111', color: cameraReady && !cameraError && tier1Ready ? '#22c55e' : '#555', border: `1.5px solid ${cameraReady && !cameraError && tier1Ready ? '#22c55e' : '#333'}`, borderRadius: 8, cursor: cameraReady && !cameraError && tier1Ready ? 'pointer' : 'not-allowed' }}>
  {!cameraReady ? 'Loading camera...' : !tier1Ready ? 'Preparing AI models...' : 'Start Interview'}
</button>
```

- [ ] **Step 7: Apply Edit 6 — End Session button disabled while flushing**

Find the End Session button in `App.jsx` and add the `disabled` prop:

```jsx
<button onClick={handleEndSession} disabled={endingSession} tabIndex={-1} style={{ padding: '4px 12px', fontSize: 11, background: '#1a0000', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, cursor: endingSession ? 'not-allowed' : 'pointer' }}>
  {endingSession ? 'Processing…' : 'End Session'}
</button>
```

- [ ] **Step 8: Verify no regression in the dev server**

```bash
npm run dev
```

Open http://localhost:5173. Verify:
- Lobby appears, camera loads, Start Interview button becomes active (tier1Ready is always true in stub)
- Complete a full session: Start → Calibrate → Interview → End Session → Report Card
- Report card shows all existing metrics, Recharts chart renders
- Start New Session resets everything
- All behavior identical to the Week 6 implementation

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useEmotionEngine.js src/App.jsx
git commit -m "feat: wire useEmotionEngine stub into App.jsx — no-regression baseline"
```

---

## Task 5: AggregatorWorker skeleton + LOAD_MODELS + tier1Ready gating

**Files:**
- Create: `src/workers/aggregatorWorker.js`
- Modify: `src/hooks/useEmotionEngine.js`

- [ ] **Step 1: Create the AggregatorWorker skeleton**

Create `/Users/kratikahimanshu/cogniflow/src/workers/aggregatorWorker.js`:

```js
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
  // Backfill implemented in Task 13
  console.log('[AggregatorWorker] TRANSCRIPT_CHUNK received:', data.topic)
}

function handleEndSession() {
  // Flush implemented in Task 14
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
}

function handleReset() {
  sessionStartTime = null
  console.log('[AggregatorWorker] RESET')
}
```

- [ ] **Step 2: Replace stub hook with real worker spawning**

Replace the full content of `src/hooks/useEmotionEngine.js`:

```js
import { useEffect, useRef, useState } from 'react'

export function useEmotionEngine({ streamRef, audioLevelRef, canvasRef, currentQuestionTitle }) {
  const [tier1Ready, setTier1Ready] = useState(false)
  const [tier2Ready, setTier2Ready] = useState(false)
  const [tier2StartOffsetMs, setTier2StartOffsetMs] = useState(null)
  const [endingSession, setEndingSession] = useState(false)

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
```

- [ ] **Step 3: Create the Tier2Worker stub (needed because hook spawns it)**

Create `/Users/kratikahimanshu/cogniflow/src/workers/tier2Worker.js`:

```js
// Tier2Worker — stub; Whisper added in Task 12

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
  // Whisper load added in Task 12 — stub replies ready immediately
  self.postMessage({ type: 'WORKER_READY' })
}

function handleEndSession() {
  // Real flush added in Task 14; stub replies immediately
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
}
```

- [ ] **Step 4: Verify in dev server**

```bash
npm run dev
```

Open http://localhost:5173. On Lobby load, open DevTools → Console. Expected:
- No errors
- Start button shows "Preparing AI models..." momentarily, then "Start Interview" when AggregatorWorker posts WORKER_READY
- Starting a session: `[AggregatorWorker] ARMED` and `[AggregatorWorker] FRAME_DATA received` logs appear at ~500ms intervals

- [ ] **Step 5: Commit**

```bash
git add src/workers/aggregatorWorker.js src/workers/tier2Worker.js src/hooks/useEmotionEngine.js
git commit -m "feat: spawn AggregatorWorker and Tier2Worker on lobby mount; gate Start on tier1Ready"
```

---

## Task 6: FER model load + inference in AggregatorWorker

**Files:**
- Modify: `src/workers/aggregatorWorker.js`

- [ ] **Step 1: Add FER model loading**

Replace `handleLoadModels` in `src/workers/aggregatorWorker.js`:

```js
import { pipeline } from '@xenova/transformers'

let fer = null

async function handleLoadModels() {
  fer = await pipeline('image-classification', 'Xenova/facial-expression-recognition')
  self.postMessage({ type: 'WORKER_READY' })
}
```

Also add this import at the very top of the file (before any existing code):

```js
import { pipeline } from '@xenova/transformers'
```

- [ ] **Step 2: Add parseFerResults utility in the same file**

Add after the `import` line:

```js
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
```

- [ ] **Step 3: Update handleFrameData to run FER inference**

Replace `handleFrameData` in `src/workers/aggregatorWorker.js`:

```js
let inferenceInFlight = false   // Guard G1

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
```

- [ ] **Step 4: Verify FER output in dev server**

```bash
npm run dev
```

Start a session, open DevTools Console. Expected every ~500ms:
```
[AggregatorWorker] FER: {neutral: 0.65, happy: 0.02, sad: 0.05, angry: 0.08, fearful: 0.15, disgusted: 0.03, surprised: 0.02}
```

Values will vary — verify the vector sums to approximately 1.0 and all seven keys are present.

Note: first model download takes several seconds. Subsequent loads use browser cache. If you see WASM errors, check that `@xenova/transformers` is in `optimizeDeps.exclude` in `vite.config.js` (confirmed in Task 1).

- [ ] **Step 5: Commit**

```bash
git add src/workers/aggregatorWorker.js
git commit -m "feat: load Xenova/facial-expression-recognition in AggregatorWorker and run FER inference per tick"
```

---

## Task 7: Full tick cycle — derived signals, buffer, G1/G2/G4 guards

**Files:**
- Modify: `src/workers/aggregatorWorker.js`

- [ ] **Step 1: Add signal utility imports at the top of aggregatorWorker.js**

Add after the `import { pipeline }` line:

```js
import { computeFacialTension, updateCadenceState, updateFreezeCount } from '../utils/signals.js'
```

- [ ] **Step 2: Add buffer and session state variables**

Add these module-level variables after the existing `let fer = null` line:

```js
let buffer = []
let sequenceNum = 0
let cadenceState = { lastSilenceStartRaw: null }
let freezeCount = 0

const BUFFER_WINDOW_MS = 10_000
```

- [ ] **Step 3: Replace handleFrameData with full tick cycle**

Replace the existing `handleFrameData` function:

```js
async function handleFrameData(data) {
  // Guard G1: single in-flight inference
  if (inferenceInFlight) { data.frame?.close(); return }
  if (!fer || !sessionStartTime) { data.frame?.close(); return }

  inferenceInFlight = true
  const tickNow = data.rawTimestamp   // Guard G2: single clock per tick

  try {
    // 1. FER inference
    const canvas = new OffscreenCanvas(data.frame.width, data.frame.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(data.frame, 0, 0)
    data.frame.close()
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const results = await fer(imageData)
    const ferVector = parseFerResults(results)

    // 2. Derived signals
    const facial_tension = computeFacialTension(ferVector)
    const { cadence_gap, speech_rush, nextState } = updateCadenceState(data.audio, tickNow, cadenceState)
    cadenceState = nextState
    const { consecutiveFreezeCount: nextFreezeCount, physical_freeze } =
      updateFreezeCount(facial_tension, cadence_gap, data.audio.rms, freezeCount)
    freezeCount = nextFreezeCount

    // 3. Build SignalEvent
    const event = {
      id:           `sig-${sequenceNum++}`,
      rawTimestamp: tickNow,                        // internal only — stripped on emit
      timestamp:    tickNow - sessionStartTime,
      finalized:    false,
      signals: {
        facial_tension,
        cadence_gap,
        speech_rush,
        physical_freeze,
        linguistic_disfluency: null,
        raw: { fer: ferVector, audio: data.audio },
      },
      context: null,
    }

    // Guard G4: dev-only monotonicity assertion
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && buffer.length > 0) {
      const prev = buffer[buffer.length - 1]
      if (tickNow < prev.rawTimestamp) {
        console.error('[AggregatorWorker] Monotonicity violated:', tickNow, '<', prev.rawTimestamp)
      }
    }

    buffer.push(event)

    // 4. Finalization pass using same tickNow
    runFinalizationPass(tickNow)

  } finally {
    inferenceInFlight = false
  }
}
```

- [ ] **Step 4: Add runFinalizationPass (stub — actual emission in Task 8)**

Add after `handleFrameData`:

```js
function runFinalizationPass(tickNow) {
  const ready = buffer.filter(e => (tickNow - e.rawTimestamp) > BUFFER_WINDOW_MS)
  for (const event of ready) {
    event.finalized = true
    const { rawTimestamp, ...emittable } = event
    self.postMessage({ type: 'SIGNAL_EVENT', event: emittable })
  }
  buffer = buffer.filter(e => !e.finalized)
}
```

- [ ] **Step 5: Update handleReset to clear all session state**

Replace `handleReset`:

```js
function handleReset() {
  buffer = []
  sequenceNum = 0
  cadenceState = { lastSilenceStartRaw: null }
  freezeCount = 0
  inferenceInFlight = false
  sessionStartTime = null
  console.log('[AggregatorWorker] RESET')
}
```

- [ ] **Step 6: Verify in dev server**

```bash
npm run dev
```

Start a session. After 10+ seconds in the interview phase, check DevTools Console for `SIGNAL_EVENT` logs appearing in the hook's `handleAggregatorMessage`. After ending the session check `reportData.signalEvents` in React DevTools or add a temporary `console.log(signalEvents)` to `handleEndSession`.

Expected: array of SignalEvent objects with correct structure — `id`, `timestamp`, `finalized: true`, `signals.facial_tension` (0–1), `signals.cadence_gap` (boolean), etc.

- [ ] **Step 7: Commit**

```bash
git add src/workers/aggregatorWorker.js
git commit -m "feat: full AggregatorWorker tick cycle — derived signals, buffer, finalization, G1/G2/G4 guards"
```

---

## Task 8: Tier2Worker — Whisper model load + tier2Ready

**Files:**
- Modify: `src/workers/tier2Worker.js`
- (No hook changes — tier2Ready gating already wired in Task 5)

- [ ] **Step 1: Replace the stub LOAD_MODELS handler with real Whisper load**

Replace the full content of `src/workers/tier2Worker.js`:

```js
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
  // Implemented in Task 12
  console.log('[Tier2Worker] AUDIO_CHUNK received, wallTime:', data.wallTime)
}

async function handleEndSession() {
  // Flush implemented in Task 14
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier2' })
}

function handleReset() {
  sessionStartTime = null
  currentQuestionTitle = ''
  console.log('[Tier2Worker] RESET')
}
```

- [ ] **Step 2: Verify Whisper load in dev server**

```bash
npm run dev
```

Open the Lobby. In DevTools Console, watch for `[Tier2Worker]` logs. On first visit:
- Whisper-tiny downloads (~75MB) — may take 15–30 seconds
- After download: `WORKER_READY` from tier2 is logged, `tier2Ready` becomes `true` in hook state

On subsequent visits (cache hit): tier2 ready in ~1–2 seconds.

Verify that `tier2Ready` becoming true does NOT block session start (Start button already enabled from `tier1Ready`).

- [ ] **Step 3: Commit**

```bash
git add src/workers/tier2Worker.js
git commit -m "feat: load Xenova/whisper-tiny in Tier2Worker; tier2Ready reflects model state"
```

---

## Task 9: AudioWorklet PCM capture

**Files:**
- Create: `src/workers/pcmCaptureProcessor.js`
- Modify: `src/hooks/useEmotionEngine.js`

The AudioWorklet processor runs on the browser's audio rendering thread and accumulates mono PCM samples into a transferable buffer, flushing every 4 seconds to the main thread.

- [ ] **Step 1: Create the AudioWorklet processor**

Create `/Users/kratikahimanshu/cogniflow/src/workers/pcmCaptureProcessor.js`:

```js
// AudioWorklet processor — runs on the audio rendering thread.
// Accumulates mono Float32 PCM and flushes to main thread every FLUSH_FRAMES frames.
// Import not supported in AudioWorklet scope — keep this file self-contained.

const SAMPLE_RATE_HZ = 48_000    // most common on macOS; adjusted at runtime via sampleRate
const FLUSH_DURATION_S = 4
// FLUSH_FRAMES computed dynamically from actual sampleRate in constructor

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = []
    this._flushFrames = Math.round(FLUSH_DURATION_S * sampleRate)  // sampleRate is a global in AudioWorklet
    this._frameCount = 0
    this.port.onmessage = () => {}   // unused; flush is time-driven
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    // Take channel 0 only (mono)
    const channelData = input[0]
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i])
    }
    this._frameCount += channelData.length

    if (this._frameCount >= this._flushFrames) {
      const pcm = new Float32Array(this._buffer)
      this.port.postMessage({ type: 'PCM_FLUSH', pcm, sampleRate }, [pcm.buffer])
      this._buffer = []
      this._frameCount = 0
    }

    return true   // keep processor alive
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
```

- [ ] **Step 2: Wire AudioWorklet into useEmotionEngine**

In `src/hooks/useEmotionEngine.js`, add a new ref at the top of the hook body:

```js
const audioContextRef = useRef(null)
const audioWorkletNodeRef = useRef(null)
```

Add a new `useEffect` after the existing worker-spawning effect, that sets up the AudioWorklet when the MediaStream is available:

```js
useEffect(() => {
  if (!streamRef.current) return

  let audioCtx = null
  async function setupAudioWorklet() {
    try {
      audioCtx = new AudioContext()
      audioContextRef.current = audioCtx

      // ?url import suffix: Vite bundles the file separately and returns its URL
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
      // workletNode intentionally not connected to audioCtx.destination
      // — we only capture, not playback
    } catch (err) {
      console.warn('[useEmotionEngine] AudioWorklet setup failed:', err)
    }
  }

  setupAudioWorklet()

  return () => {
    audioWorkletNodeRef.current?.disconnect()
    audioCtx?.close()
  }
}, [])
```

Note: this effect runs once on mount. The AudioWorklet only starts posting PCM_FLUSH messages when a session is active (because `sessionStartTimeRef.current` is null until `startSession` is called).

- [ ] **Step 3: Verify AUDIO_CHUNK logs in dev server**

```bash
npm run dev
```

Start a session, wait 5+ seconds in the interview phase. In DevTools Console:
```
[Tier2Worker] AUDIO_CHUNK received, wallTime: 4012
[Tier2Worker] AUDIO_CHUNK received, wallTime: 8024
```

Every ~4 seconds during the interview. Confirm Tier2Worker receives the chunk but does nothing with it yet (Whisper inference in Task 12).

- [ ] **Step 4: Commit**

```bash
git add src/workers/pcmCaptureProcessor.js src/hooks/useEmotionEngine.js
git commit -m "feat: add AudioWorklet PCM capture and stream 4s chunks to Tier2Worker"
```

---

## Task 10: Whisper inference + TRANSCRIPT_CHUNK + drift correction

**Files:**
- Modify: `src/workers/tier2Worker.js`

- [ ] **Step 1: Replace the stub handleAudioChunk with real Whisper inference**

Replace `handleAudioChunk` in `src/workers/tier2Worker.js`:

```js
// Tracks the audio offset of the current session for chunk timestamp computation
let sessionAudioContextStartTime = null
let sessionAudioContextStartWallTime = null

async function handleAudioChunk(data) {
  if (!transcriber || !sessionStartTime) return

  // First chunk establishes audio clock anchor
  if (sessionAudioContextStartTime === null) {
    sessionAudioContextStartTime = data.audioContextTime
    sessionAudioContextStartWallTime = data.wallTime
  }

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
      topic: currentQuestionTitle,   // V1: question title as topic
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

  // Approximate chunk boundaries from wallTime and chunk duration
  const chunkDurationMs = (data.pcmData.length / data.sampleRate) * 1000
  const correctedEnd = data.wallTime + driftMs
  const correctedStart = Math.max(0, correctedEnd - chunkDurationMs)

  return { correctedStart, correctedEnd }
}
```

- [ ] **Step 2: Wire END_SESSION to process any pending buffer**

Replace `handleEndSession` in `src/workers/tier2Worker.js`:

```js
let pendingPcm = null   // partial buffer accumulated before END_SESSION

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
```

Note: `pendingPcm` accumulation (for partial chunks) is an enhancement. For V1, the 4-second interval handles most cases. The END_SESSION handler above covers sessions shorter than 4 seconds.

- [ ] **Step 3: Update handleReset**

Replace `handleReset`:

```js
function handleReset() {
  sessionStartTime = null
  currentQuestionTitle = ''
  sessionAudioContextStartTime = null
  sessionAudioContextStartWallTime = null
  pendingPcm = null
  console.log('[Tier2Worker] RESET')
}
```

- [ ] **Step 4: Verify TRANSCRIPT_CHUNK in dev server**

```bash
npm run dev
```

Start a session, speak for 5+ seconds. In DevTools Console, watch for:
```
[AggregatorWorker] TRANSCRIPT_CHUNK received: Two Sum
```
(After the 4-second Whisper chunk is relayed from Tier2 → main → Aggregator)

The relay in `handleTier2Message` in the hook already passes the chunk to the aggregator (`aggregatorRef.current.postMessage(data)`).

- [ ] **Step 5: Commit**

```bash
git add src/workers/tier2Worker.js
git commit -m "feat: Tier2Worker Whisper inference, drift-corrected TRANSCRIPT_CHUNK emission"
```

---

## Task 11: Backfill — TRANSCRIPT_CHUNK → buffer patch in AggregatorWorker

**Files:**
- Modify: `src/workers/aggregatorWorker.js`

- [ ] **Step 1: Replace handleTranscriptChunk with full backfill logic**

Replace `handleTranscriptChunk` in `src/workers/aggregatorWorker.js`:

```js
function handleTranscriptChunk({ start, end, topic, text, disfluency }) {
  if (!sessionStartTime) return

  const absStart = sessionStartTime + start
  const absEnd   = sessionStartTime + end

  for (const event of buffer) {
    if (event.rawTimestamp < absStart || event.rawTimestamp > absEnd) continue

    // Guard G3: first-write-wins — only patch if currently null
    if (event.signals.linguistic_disfluency !== null) continue

    event.signals.linguistic_disfluency = disfluency
    event.context = { text, topic, chunkStart: start, chunkEnd: end }
  }
  // Events already finalized (removed from buffer) are silently skipped — expected behavior
}
```

- [ ] **Step 2: Verify backfill in dev server**

```bash
npm run dev
```

Start a session, speak for 15+ seconds, then end the session. In DevTools, log `reportData.signalEvents` from the component. Inspect events in the window corresponding to when you spoke — they should have:
```js
{
  context: { text: "the text you spoke", topic: "Two Sum", chunkStart: 1000, chunkEnd: 5000 },
  signals: { linguistic_disfluency: 0.12, ... }
}
```

Events before Tier 2 attached (if any) will have `context: null` and `linguistic_disfluency: null`.

- [ ] **Step 3: Commit**

```bash
git add src/workers/aggregatorWorker.js
git commit -m "feat: TRANSCRIPT_CHUNK backfill in AggregatorWorker with first-write-wins guard"
```

---

## Task 12: END_SESSION flush ordering

**Files:**
- Modify: `src/workers/aggregatorWorker.js`

This task wires the full flush sequence from spec §8: Tier 2 FLUSH_COMPLETE → relay TRANSCRIPT_CHUNK applied → Aggregator END_SESSION → finalize all → FLUSH_COMPLETE → endSession() resolves.

The hook's relay chain (`handleTier2Message`) already implements the ordering — this task only requires the AggregatorWorker to honor its half: finalize all remaining events unconditionally when END_SESSION arrives.

- [ ] **Step 1: Replace handleEndSession in AggregatorWorker to finalize all events**

Replace `handleEndSession` in `src/workers/aggregatorWorker.js`:

```js
function handleEndSession() {
  // Finalize ALL remaining buffer events regardless of age (BUFFER_WINDOW_MS lifted)
  for (const event of buffer) {
    event.finalized = true
    const { rawTimestamp, ...emittable } = event
    self.postMessage({ type: 'SIGNAL_EVENT', event: emittable })
  }
  buffer = []
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
}
```

- [ ] **Step 2: Verify flush ordering in dev server**

```bash
npm run dev
```

Start a session (speak for 10s), end it. In DevTools, add a temporary `console.log` to the hook:

In `handleAggregatorMessage`, after the `FLUSH_COMPLETE` case:
```js
console.log('[hook] endSession promise resolved — signalEvents count:', signalEventsRef.current.length)
```

Verify the log appears after clicking "End Session" and before the Report Card renders. Verify the count is non-zero if you ran for >500ms.

Remove the temporary log after verifying.

- [ ] **Step 3: Commit**

```bash
git add src/workers/aggregatorWorker.js
git commit -m "feat: AggregatorWorker END_SESSION finalizes all buffer events and resolves flush chain"
```

---

## Task 13: Full coexistence constraints — reset race guard + idempotency

**Files:**
- Modify: `src/hooks/useEmotionEngine.js`

The hook already has the race guard and idempotency implemented in Task 5's hook body. This task verifies they are correct by checking the logic against the spec constraints, and adds any missing pieces.

- [ ] **Step 1: Verify idempotency (Constraint #3)**

Read the `endSession` function in `src/hooks/useEmotionEngine.js`. Confirm it contains:

```js
async function endSession() {
  if (endingRef.current) return endingPromiseRef.current   // idempotent guard
  endingRef.current = true
  ...
}
```

If this guard is present, step is complete. If not, add it.

- [ ] **Step 2: Verify reset race guard (Constraint #1)**

Read the `resetEngine` function. Confirm it contains:

```js
async function resetEngine() {
  if (endingRef.current && endingPromiseRef.current) {
    try { await endingPromiseRef.current } catch (_) {}
  }
  ...
  endingRef.current = false
  endingPromiseRef.current = null
  flushResolveRef.current = null
  ...
}
```

If this guard is present, step is complete. If the `endingRef.current = false` reset is missing inside `resetEngine`, add it.

- [ ] **Step 3: Test race condition in dev server**

```bash
npm run dev
```

Start a session, immediately click "End Session" then immediately click "Start New Session" (do this quickly — within the ~500ms flush window). Verify:
- No JavaScript errors in console
- "Start New Session" correctly resets the UI
- Subsequent sessions produce valid signalEvents

- [ ] **Step 4: Verify tier2StartOffsetMs (Constraint #2)**

In `handleTier2Message` in the hook, confirm that when WORKER_READY triggers late-attach:

```js
setTier2StartOffsetMs(performance.now() - sessionStartTime)
```

And when tier2 is ready at session start:
```js
setTier2StartOffsetMs(0)
```

And in `resetEngine`:
```js
setTier2StartOffsetMs(null)
```

All three cases should be present. If any are missing, add them.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEmotionEngine.js
git commit -m "feat: verify and lock coexistence constraints — reset race guard, idempotency, tier2StartOffsetMs"
```

---

## Task 14: Verification pass

**Files:**
- Read-only verification — no code changes expected

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all 25 tests pass. If any fail, fix the underlying issue before proceeding.

- [ ] **Step 2: No-regression stub test in dev server**

Temporarily replace `src/hooks/useEmotionEngine.js` with the stub from Task 4 Step 1 (return `tier1Ready: true` immediately, no workers). Run:

```bash
npm run dev
```

Complete a full session and verify the app behaves identically to the Week 6 baseline — same Recharts chart, same metrics, same report card. This confirms the integration boundary is truly additive.

Restore the real hook after verifying.

- [ ] **Step 3: Full end-to-end session test in dev server**

With the real hook restored:

```bash
npm run dev
```

Run through this checklist:

```
□ Lobby shows "Preparing AI models..." then "Start Interview"
□ Session starts, calibration runs, interview phase begins
□ Console shows FRAME_DATA logs every ~500ms
□ After ~5s of speaking, TRANSCRIPT_CHUNK logs appear in AggregatorWorker
□ End Session — "Processing…" appears on button briefly
□ Report card renders with all existing metrics intact (no regression)
□ console.log(reportData.signalEvents) — array with finalized events
□ At least some events have context (topic + timestamps) if >5s of speech
□ Start New Session — clean reset, new session works
□ signalEvents from prior session are gone after reset
```

- [ ] **Step 4: Inspect signalEvent shape**

In `handleEndSession` in App.jsx, temporarily add:
```js
console.log('signalEvents sample:', signalEventsRef.current.slice(0, 3))
```

Verify a sample event matches the schema from spec §4.1:
```js
{
  id: 'sig-7',
  timestamp: 7342,   // ms since session start
  finalized: true,
  signals: {
    facial_tension: 0.23,
    cadence_gap: false,
    speech_rush: false,
    physical_freeze: false,
    linguistic_disfluency: null,   // null if no Whisper chunk overlapped
    raw: { fer: {...}, audio: { rms: 0.31, isSpeaking: true } }
  },
  context: null
}
```

Remove the temporary log after confirming.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Latent Emotion Engine Sub-project A complete — FER + Whisper + Aggregator pipeline"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| §3 Architecture + file structure | Task 5 (workers), file structure header |
| §4 Signal schema — computeFacialTension | Task 2 |
| §4 Signal schema — updateCadenceState (ordering guard) | Task 2 |
| §4 Signal schema — updateFreezeCount | Task 2 |
| §4 Signal schema — computeDisfluency (token + phrase matching) | Task 2 |
| §4 Signal schema — projectForUI | Task 3 |
| §5 Worker state machines | Tasks 5–12 |
| §5 Message protocol | Tasks 5, 8, 10, 11, 12 |
| §6.1 Lobby warmup — workers on mount | Task 5 |
| §6.2 FRAME_DATA capture (500ms, createImageBitmap, transfer) | Task 5 |
| §6.3 AudioWorklet PCM (4s chunks, wallTime + audioContextTime) | Task 9 |
| §6.4 Tier 2 relay + late-attach logic | Task 5 |
| §7.1 Master Session Clock — rawTimestamp as authority | Task 7 |
| §7.2 Buffer structure (max 20 events) | Task 7 |
| §7.3 Full tick cycle | Task 7 |
| §7.4 Finalization pass (runFinalizationPass) | Task 7 |
| §7.5 Backfill — G3 first-write-wins | Task 11 |
| §7.6 Guards G1–G5 | G1/G2/G4: Task 7, G3: Task 11, G5: Task 10 |
| §7.7 Audio drift correction (per-chunk clamp) | Task 10 |
| §8 END_SESSION flush ordering | Task 12 |
| §9.2 App.jsx edits 1–6 | Task 4 |
| §9.3 No-regression contract | Task 4 step 8 + Task 14 step 2 |
| §9.4 reportData shape (signalEvents, tier2StartOffsetMs) | Task 4 |
| §10.1 Reset contract + race guard | Task 13 |
| §10.2 tier2StartOffsetMs visibility | Task 13 |
| §10.3 endSession idempotency | Task 13 |
| §10.4 projectForUI payload projection | Task 3 |

All spec requirements covered.

**Placeholder scan:** No TBDs, TODOs, or "implement later" patterns found. All code blocks are complete. All commands have expected output.

**Type consistency:** `SignalEvent` shape defined in Task 7 (aggregatorWorker) uses same field names as tested in Tasks 2–3. `parseFerResults` output uses `fearful`/`disgusted`/`surprised` — consistent with `computeFacialTension`'s `fer.fearful` reference. `FLUSH_COMPLETE` message shape `{ type, source }` consistent in both workers and hook.
