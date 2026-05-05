# Blendshape Emotion Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hugging Face FER model with MediaPipe blendshape-based emotion detection on the main thread, adding `smile`, `fear`, `anger`, `contempt` signals to the report chart and stress index.

**Architecture:** A new pure module `emotionFormulas.js` does the math. `useEmotionEngine` becomes the single source of truth — it computes + smooths emotions on the main thread every animation frame and forwards 5 derived floats to the worker on a 100ms throttle. `aggregatorWorker` no longer loads or runs a model; it just stamps the floats onto finalized events. `App.jsx` enables `outputFaceBlendshapes`, calls into the engine each frame, and integrates emotion deltas into a frame-rate-independent stress update with a clamped Δt.

**Tech Stack:** React 19, Vite, MediaPipe `tasks-vision` 0.10.3 (CDN), Recharts (dual Y-axis `ComposedChart`), Vitest.

**Spec:** [docs/superpowers/specs/2026-05-05-blendshape-emotion-detection-design.md](../specs/2026-05-05-blendshape-emotion-detection-design.md)

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/utils/emotionFormulas.js` | NEW | Pure functions: `computeEmotions(blendshapes)` and `smoothEmotions(prev, current)`. No I/O, no React. |
| `src/utils/__tests__/emotionFormulas.test.js` | NEW | Unit tests for both pure functions. |
| `src/utils/signalSchema.js` | MODIFY | `projectForUI` exposes 4 new optional emotion fields. |
| `src/utils/__tests__/signalSchema.test.js` | MODIFY | Add coverage for the new fields. |
| `src/utils/reportTimeline.js` | MODIFY | `buildUnifiedTimeline` populates emotion + audio fields per point. |
| `src/utils/__tests__/reportTimeline.test.js` | MODIFY | Add coverage for the new fields. |
| `src/utils/signals.js` | MODIFY | Remove `computeFacialTension` (now lives in `emotionFormulas.js`). |
| `src/utils/__tests__/signals.test.js` | MODIFY | Drop the `computeFacialTension` describe block (covered in new test file). |
| `src/workers/aggregatorWorker.js` | MODIFY | Remove `@huggingface/transformers` + FER inference. New `FRAME_DATA` contract: `{ emotions, audio, rawTimestamp }`. |
| `src/hooks/useEmotionEngine.js` | MODIFY | Add `pushBlendshapes(blendshapes, audio, rawTimestamp)`. Hold smoothing state + emotion ref. Throttle worker post to 100ms. Remove `startFrameCapture`. |
| `src/App.jsx` | MODIFY | Set `outputFaceBlendshapes: true`. Call `pushBlendshapes` from the FaceLandmarker loop. Time-scaled stress update with clamped Δt. Dual-Y-axis `ComposedChart` with emotion + audio lines. |

---

## Task 1: Add `clamp` import availability

**Files:**
- Read: `src/utils/signals.js` (already exports `clamp`)

This is a trivial check task — no code change. We rely on `clamp` re-exported from `signals.js` for the new module.

- [ ] **Step 1: Verify `clamp` is exported from `signals.js`**

Run: `grep "^export function clamp" src/utils/signals.js`
Expected output: `export function clamp(value, min, max) {`

If absent, stop and ask the planner.

- [ ] **Step 2: No commit needed**

---

## Task 2: Pure emotion formula module — `computeEmotions`

**Files:**
- Create: `src/utils/emotionFormulas.js`
- Create: `src/utils/__tests__/emotionFormulas.test.js`

- [ ] **Step 1: Write the failing test**

Write `src/utils/__tests__/emotionFormulas.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { computeEmotions } from '../emotionFormulas.js'

// Helper — build a blendshape map with all features at 0, then override.
function bs(overrides = {}) {
  const keys = [
    'mouthSmileLeft', 'mouthSmileRight',
    'browInnerUp',
    'eyeWideLeft', 'eyeWideRight',
    'mouthStretchLeft', 'mouthStretchRight',
    'browDownLeft', 'browDownRight',
    'noseSneerLeft', 'noseSneerRight',
    'eyeSquintLeft', 'eyeSquintRight',
    'mouthFrownLeft', 'mouthFrownRight',
  ]
  const out = {}
  for (const k of keys) out[k] = 0
  return { ...out, ...overrides }
}

describe('computeEmotions', () => {
  it('returns all-zero emotions for a relaxed face', () => {
    const e = computeEmotions(bs())
    expect(e.smile).toBe(0)
    expect(e.fear).toBe(0)
    expect(e.anger).toBe(0)
    expect(e.contempt).toBe(0)
    expect(e.facial_tension).toBe(0)
  })

  it('averages bilateral smile (left+right)/2', () => {
    expect(computeEmotions(bs({ mouthSmileLeft: 1, mouthSmileRight: 1 })).smile).toBe(1)
    expect(computeEmotions(bs({ mouthSmileLeft: 1, mouthSmileRight: 0 })).smile).toBe(0.5)
  })

  it('saturates fear at 1.0 only when ALL fear features are at max', () => {
    const fearMax = bs({
      browInnerUp: 1,
      eyeWideLeft: 1, eyeWideRight: 1,
      mouthStretchLeft: 1, mouthStretchRight: 1,
    })
    expect(computeEmotions(fearMax).fear).toBeCloseTo(1.0, 5)
  })

  it('does NOT saturate anger from a strong frown alone (regression: bilateral averaging)', () => {
    // Pre-fix bug: (1+1)*0.4 + (1+1)*0.3 = 1.4 → clamped to 1.0
    // After fix: avg(1,1)*0.4 + avg(1,1)*0.3 = 0.7 (only the brow + sneer paths)
    const heavyFrownAndSneer = bs({
      browDownLeft: 1, browDownRight: 1,
      noseSneerLeft: 1, noseSneerRight: 1,
    })
    expect(computeEmotions(heavyFrownAndSneer).anger).toBeCloseTo(0.7, 5)
  })

  it('anger reaches 0.85 ceiling when every anger feature is at max', () => {
    const angerMax = bs({
      browDownLeft: 1, browDownRight: 1,
      noseSneerLeft: 1, noseSneerRight: 1,
      eyeSquintLeft: 1, eyeSquintRight: 1,
    })
    expect(computeEmotions(angerMax).anger).toBeCloseTo(0.85, 5)
  })

  it('contempt reaches 0.7 ceiling when every contempt feature is at max', () => {
    const contemptMax = bs({
      mouthFrownLeft: 1, mouthFrownRight: 1,
      browDownLeft: 1, browDownRight: 1,
    })
    expect(computeEmotions(contemptMax).contempt).toBeCloseTo(0.7, 5)
  })

  it('derives facial_tension as fear*0.6 + anger*0.3 + contempt*0.1', () => {
    // Build a face where fear=1, anger=0, contempt=0 → facial_tension = 0.6
    const fearOnly = bs({
      browInnerUp: 1,
      eyeWideLeft: 1, eyeWideRight: 1,
      mouthStretchLeft: 1, mouthStretchRight: 1,
    })
    expect(computeEmotions(fearOnly).facial_tension).toBeCloseTo(0.6, 5)
  })

  it('clamps every output to [0, 1]', () => {
    // Defensive — even with crazy input values, output is clamped.
    const e = computeEmotions(bs({
      browInnerUp: 5, eyeWideLeft: 5, eyeWideRight: 5,
      mouthStretchLeft: 5, mouthStretchRight: 5,
    }))
    expect(e.fear).toBeLessThanOrEqual(1)
    expect(e.fear).toBeGreaterThanOrEqual(0)
  })

  it('handles missing blendshape keys as 0', () => {
    const e = computeEmotions({ mouthSmileLeft: 0.4, mouthSmileRight: 0.6 })
    expect(e.smile).toBeCloseTo(0.5, 5)
    expect(e.fear).toBe(0)
    expect(e.anger).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test — expect failures**

Run: `npm test -- src/utils/__tests__/emotionFormulas.test.js`
Expected: All tests FAIL with `Cannot find module '../emotionFormulas.js'`.

- [ ] **Step 3: Implement `computeEmotions`**

Create `src/utils/emotionFormulas.js`:

```js
import { clamp } from './signals.js'

const avg = (a = 0, b = 0) => (a + b) / 2

/**
 * Pure — given a MediaPipe blendshape name→score map, return derived emotion
 * scores in [0, 1] plus the composite facial_tension.
 *
 * Note on bounds: anger is bounded by 0.85 (weights sum to 0.85, intentional)
 * and contempt by 0.70 (intentional). This biases against false positives in
 * an interview-coaching context. See spec §"Emotion Formulas".
 */
export function computeEmotions(bs = {}) {
  const smile = avg(bs.mouthSmileLeft, bs.mouthSmileRight)

  const fear = clamp(
    (bs.browInnerUp || 0) * 0.40 +
    avg(bs.eyeWideLeft, bs.eyeWideRight) * 0.30 +
    avg(bs.mouthStretchLeft, bs.mouthStretchRight) * 0.30,
    0, 1,
  )

  const anger = clamp(
    avg(bs.browDownLeft, bs.browDownRight) * 0.40 +
    avg(bs.noseSneerLeft, bs.noseSneerRight) * 0.30 +
    avg(bs.eyeSquintLeft, bs.eyeSquintRight) * 0.15,
    0, 1,
  )

  const contempt = clamp(
    avg(bs.mouthFrownLeft, bs.mouthFrownRight) * 0.40 +
    avg(bs.browDownLeft, bs.browDownRight) * 0.30,
    0, 1,
  )

  const facial_tension = clamp(fear * 0.6 + anger * 0.3 + contempt * 0.1, 0, 1)

  return { smile, fear, anger, contempt, facial_tension }
}
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `npm test -- src/utils/__tests__/emotionFormulas.test.js`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/emotionFormulas.js src/utils/__tests__/emotionFormulas.test.js
git commit -m "feat: add pure blendshape→emotion formula module"
```

---

## Task 3: Smoothing function — `smoothEmotions`

**Files:**
- Modify: `src/utils/emotionFormulas.js`
- Modify: `src/utils/__tests__/emotionFormulas.test.js`

- [ ] **Step 1: Write the failing test (append to existing test file)**

Append to `src/utils/__tests__/emotionFormulas.test.js`:

```js
import { smoothEmotions } from '../emotionFormulas.js'

describe('smoothEmotions', () => {
  const ZERO = { smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }

  it('returns the current values when prev is null (cold start)', () => {
    const current = { smile: 0.3, fear: 0.2, anger: 0.1, contempt: 0.05, facial_tension: 0.15 }
    expect(smoothEmotions(null, current)).toEqual(current)
  })

  it('applies 80/20 weighting: smoothed = 0.8*prev + 0.2*current', () => {
    const prev    = { smile: 1, fear: 0, anger: 0,   contempt: 0,   facial_tension: 0 }
    const current = { smile: 0, fear: 1, anger: 0.5, contempt: 0.5, facial_tension: 0.5 }
    const s = smoothEmotions(prev, current)
    expect(s.smile).toBeCloseTo(0.8, 5)
    expect(s.fear).toBeCloseTo(0.2, 5)
    expect(s.anger).toBeCloseTo(0.1, 5)
    expect(s.contempt).toBeCloseTo(0.1, 5)
    expect(s.facial_tension).toBeCloseTo(0.1, 5)
  })

  it('converges toward current after many ticks', () => {
    let s = ZERO
    const target = { smile: 0.7, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }
    for (let i = 0; i < 100; i++) s = smoothEmotions(s, target)
    expect(s.smile).toBeCloseTo(0.7, 3)
  })
})
```

- [ ] **Step 2: Run the test — expect failures**

Run: `npm test -- src/utils/__tests__/emotionFormulas.test.js`
Expected: 3 new tests FAIL (`smoothEmotions is not exported`).

- [ ] **Step 3: Implement `smoothEmotions`**

Append to `src/utils/emotionFormulas.js`:

```js
const KEYS = ['smile', 'fear', 'anger', 'contempt', 'facial_tension']

/**
 * Pure — exponential smoothing per emotion key. Caller owns the prev state.
 * `prev = null` returns `current` unchanged (cold start).
 */
export function smoothEmotions(prev, current) {
  if (!prev) return { ...current }
  const out = {}
  for (const k of KEYS) {
    out[k] = 0.8 * (prev[k] ?? 0) + 0.2 * (current[k] ?? 0)
  }
  return out
}
```

- [ ] **Step 4: Run all tests in this file**

Run: `npm test -- src/utils/__tests__/emotionFormulas.test.js`
Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/emotionFormulas.js src/utils/__tests__/emotionFormulas.test.js
git commit -m "feat: add 80/20 emotion smoothing helper"
```

---

## Task 4: Update signal schema for emotion fields

**Files:**
- Modify: `src/utils/signalSchema.js`
- Modify: `src/utils/__tests__/signalSchema.test.js`

- [ ] **Step 1: Update the test fixture and add a coverage test**

Edit `src/utils/__tests__/signalSchema.test.js`. Update the `FULL_EVENT.signals` block to include emotion fields:

```js
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
    smile: 0.05,
    fear: 0.6,
    anger: 0.2,
    contempt: 0.1,
    raw: {
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
```

Add a new `it` block at the end of the `describe('projectForUI', ...)`:

```js
  it('exposes the four emotion fields when present', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.signals.smile).toBe(0.05)
    expect(p.signals.fear).toBe(0.6)
    expect(p.signals.anger).toBe(0.2)
    expect(p.signals.contempt).toBe(0.1)
  })

  it('omits emotion fields when missing on the source event', () => {
    const minimal = {
      id: 'sig-2',
      timestamp: 100,
      finalized: true,
      signals: {
        facial_tension: 0,
        cadence_gap: false,
        speech_rush: false,
        physical_freeze: false,
        linguistic_disfluency: null,
        raw: { audio: { rms: 0, isSpeaking: false } },
      },
      context: null,
    }
    const p = projectForUI(minimal)
    expect(p.signals.smile).toBeUndefined()
    expect(p.signals.fear).toBeUndefined()
    expect(p.signals.anger).toBeUndefined()
    expect(p.signals.contempt).toBeUndefined()
  })
```

- [ ] **Step 2: Run the test — expect 2 new failures**

Run: `npm test -- src/utils/__tests__/signalSchema.test.js`
Expected: 5 existing tests PASS, 1 new test FAIL (emotions undefined), 1 new test PASS coincidentally (also undefined). Read the failure carefully.

- [ ] **Step 3: Update `projectForUI` to forward emotion fields**

Edit `src/utils/signalSchema.js`. Replace the `signals` block in `projectForUI`:

```js
export function projectForUI(event) {
  const s = event.signals
  return {
    id:        event.id,
    timestamp: event.timestamp,
    signals: {
      facial_tension:        s.facial_tension,
      cadence_gap:           s.cadence_gap,
      speech_rush:           s.speech_rush,
      physical_freeze:       s.physical_freeze,
      linguistic_disfluency: s.linguistic_disfluency,
      ...(typeof s.smile    === 'number' && { smile:    s.smile }),
      ...(typeof s.fear     === 'number' && { fear:     s.fear }),
      ...(typeof s.anger    === 'number' && { anger:    s.anger }),
      ...(typeof s.contempt === 'number' && { contempt: s.contempt }),
    },
    context: event.context && {
      topic:      event.context.topic,
      chunkStart: event.context.chunkStart,
      chunkEnd:   event.context.chunkEnd,
    },
  }
}
```

- [ ] **Step 4: Run the test — expect all 7 to pass**

Run: `npm test -- src/utils/__tests__/signalSchema.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/signalSchema.js src/utils/__tests__/signalSchema.test.js
git commit -m "feat: forward smile/fear/anger/contempt through signal schema"
```

---

## Task 5: Drop `computeFacialTension` from `signals.js`

The composite `facial_tension` is now derived inside `computeEmotions`. The standalone helper is dead code.

**Files:**
- Modify: `src/utils/signals.js`
- Modify: `src/utils/__tests__/signals.test.js`
- Modify: `src/workers/aggregatorWorker.js` (remove import)

- [ ] **Step 1: Remove `computeFacialTension` from `signals.js`**

Edit `src/utils/signals.js`. Delete the entire function:

```js
export function computeFacialTension(fer) {
  return clamp(fer.fearful * 0.6 + fer.angry * 0.3 + fer.disgusted * 0.1, 0, 1)
}
```

- [ ] **Step 2: Remove the import + tests from `signals.test.js`**

Edit `src/utils/__tests__/signals.test.js`. Update the import line (remove `computeFacialTension`):

```js
import { clamp, updateCadenceState, updateFreezeCount, computeDisfluency } from '../signals.js'
```

Delete the entire `describe('computeFacialTension', ...)` block (around lines 16–37 of the existing file).

- [ ] **Step 3: Remove the import from the worker** (will be gutted further in Task 6, but clean this now to keep tests green)

Edit `src/workers/aggregatorWorker.js` line 6:

```js
// before
import { computeFacialTension, updateCadenceState, updateFreezeCount } from '../utils/signals.js'
// after
import { updateCadenceState, updateFreezeCount } from '../utils/signals.js'
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All previously passing tests still PASS. The `computeFacialTension` describe block is gone.

- [ ] **Step 5: Commit**

```bash
git add src/utils/signals.js src/utils/__tests__/signals.test.js src/workers/aggregatorWorker.js
git commit -m "refactor: drop computeFacialTension; emotionFormulas owns derivation"
```

---

## Task 6: Refactor `aggregatorWorker` — drop FER, accept pre-computed emotions

**Files:**
- Modify: `src/workers/aggregatorWorker.js`

The worker no longer loads a model, no longer renders frames to canvas, and no longer runs inference. It receives `{ emotions, audio, rawTimestamp }` and stamps the emotion values onto each `SignalEvent`.

- [ ] **Step 1: Replace the worker body**

Overwrite `src/workers/aggregatorWorker.js` with:

```js
// AggregatorWorker — Tier 1
// Receives pre-computed emotion floats from the main thread, runs cadence
// state machine + freeze detector, and stamps emotion values onto finalized
// SignalEvents emitted to the main thread.
//
// State machine: IDLE → READY → ARMED → RUNNING → FLUSHING → IDLE
// (No model load — WORKER_READY is fired immediately on LOAD_MODELS for
// API parity with the previous Hugging Face flow.)

import { updateCadenceState, updateFreezeCount } from '../utils/signals.js'

let sessionStartTime = null
let ending = false

let buffer = []
let sequenceNum = 0
let cadenceState = { lastSilenceStartRaw: null, lastSpeechStartRaw: null, silenceBeforeSpeech: 0 }
let latestCadenceResult = { cadence_gap: false, speech_rush: false, acoustic_disfluency: false }
let freezeCount = 0

const BUFFER_WINDOW_MS = 10_000

self.onmessage = (e) => {
  const data = e?.data
  if (!data || typeof data.type !== 'string') {
    console.warn('[AggregatorWorker] dropping malformed message', data)
    return
  }
  const { type } = data
  try {
    switch (type) {
      case 'LOAD_MODELS':       handleLoadModels(); break
      case 'START_SESSION':     handleStartSession(data); break
      case 'FRAME_DATA':        handleFrameData(data); break
      case 'TRANSCRIPT_CHUNK':  handleTranscriptChunk(data); break
      case 'END_SESSION':       handleEndSession(); break
      case 'RESET':             handleReset(); break
      default: console.warn('[AggregatorWorker] unknown message type:', type)
    }
  } catch (err) {
    console.error(`[AggregatorWorker] handler '${type}' threw:`, err)
    if (type === 'END_SESSION') {
      self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
    }
  }
}

function handleLoadModels() {
  // No model to load — the main thread now owns emotion compute.
  // Fire WORKER_READY immediately so existing init UI behaves the same.
  self.postMessage({ type: 'WORKER_READY' })
}

function handleStartSession({ sessionStartTime: t }) {
  sequenceNum = 0
  sessionStartTime = t
  console.log('[AggregatorWorker] ARMED — sessionStartTime:', t)
}

function handleFrameData(data) {
  const tickNow = data.rawTimestamp
  const emotions = data.emotions || {}

  // 1. Cadence state machine
  const { cadence_gap, speech_rush, acoustic_disfluency, nextState } =
    updateCadenceState(data.audio, tickNow, cadenceState)
  cadenceState = nextState

  latestCadenceResult.cadence_gap = cadence_gap
  if (speech_rush) latestCadenceResult.speech_rush = true
  if (acoustic_disfluency) latestCadenceResult.acoustic_disfluency = true

  if (!sessionStartTime || ending) return

  // 2. Use main-thread-computed facial_tension for freeze detection
  const facial_tension = typeof emotions.facial_tension === 'number' ? emotions.facial_tension : 0

  const latestCadenceGap = latestCadenceResult.cadence_gap
  const latestSpeechRush = latestCadenceResult.speech_rush
  const latestDisfluency = latestCadenceResult.acoustic_disfluency

  latestCadenceResult.speech_rush = false
  latestCadenceResult.acoustic_disfluency = false

  const { consecutiveFreezeCount: nextFreezeCount, physical_freeze } =
    updateFreezeCount(facial_tension, latestCadenceGap, data.audio.rms, freezeCount)
  freezeCount = nextFreezeCount

  // 3. Build SignalEvent — emotion fields stamped from main-thread input
  const event = {
    id:           `sig-${sequenceNum++}`,
    rawTimestamp: tickNow,
    timestamp:    tickNow - sessionStartTime,
    finalized:    false,
    signals: {
      facial_tension,
      cadence_gap:           latestCadenceGap,
      speech_rush:           latestSpeechRush,
      physical_freeze,
      linguistic_disfluency: latestDisfluency ? 0.5 : null,
      smile:    typeof emotions.smile    === 'number' ? emotions.smile    : 0,
      fear:     typeof emotions.fear     === 'number' ? emotions.fear     : 0,
      anger:    typeof emotions.anger    === 'number' ? emotions.anger    : 0,
      contempt: typeof emotions.contempt === 'number' ? emotions.contempt : 0,
      raw:      { audio: data.audio },
    },
    context: null,
  }

  if (import.meta.env?.DEV && buffer.length > 0) {
    const prev = buffer[buffer.length - 1]
    console.assert(
      tickNow >= prev.rawTimestamp,
      '[AggregatorWorker] G4 monotonicity violated: %d < %d', tickNow, prev.rawTimestamp,
    )
  }

  buffer.push(event)
  runFinalizationPass(tickNow)
}

function runFinalizationPass(tickNow) {
  const ready = buffer.filter(e => (tickNow - e.rawTimestamp) > BUFFER_WINDOW_MS)
  for (const event of ready) {
    event.finalized = true
    const { rawTimestamp, ...emittable } = event
    self.postMessage({ type: 'SIGNAL_EVENT', event: emittable })
  }
  buffer = buffer.filter(e => !e.finalized)
}

function handleTranscriptChunk({ start, end, topic, text, disfluency }) {
  if (!sessionStartTime) return
  const absStart = sessionStartTime + start
  const absEnd   = sessionStartTime + end
  for (const event of buffer) {
    if (event.rawTimestamp < absStart || event.rawTimestamp > absEnd) continue
    event.signals.linguistic_disfluency = Math.max(event.signals.linguistic_disfluency || 0, disfluency)
    event.context = { text, topic, chunkStart: start, chunkEnd: end }
  }
}

function handleEndSession() {
  ending = true
  console.log('[AggregatorWorker] END_SESSION — flushing', buffer.length, 'buffered events')
  for (const event of buffer) {
    event.finalized = true
    const { rawTimestamp, ...emittable } = event
    self.postMessage({ type: 'SIGNAL_EVENT', event: emittable })
  }
  buffer = []
  self.postMessage({ type: 'FLUSH_COMPLETE', source: 'tier1' })
}

function handleReset() {
  buffer = []
  sequenceNum = 0
  cadenceState = { lastSilenceStartRaw: null, lastSpeechStartRaw: null, silenceBeforeSpeech: 0 }
  freezeCount = 0
  latestCadenceResult = { cadence_gap: false, speech_rush: false, acoustic_disfluency: false }
  ending = false
  sessionStartTime = null
  console.log('[AggregatorWorker] RESET')
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: All tests PASS. (No tests directly touch the worker; everything stays green.)

- [ ] **Step 3: Verify the worker module no longer references `@huggingface/transformers`**

Run: `grep -n "huggingface\|RawImage\|pipeline\|OffscreenCanvas" src/workers/aggregatorWorker.js`
Expected: No output (zero matches).

- [ ] **Step 4: Commit**

```bash
git add src/workers/aggregatorWorker.js
git commit -m "refactor(worker): drop FER inference; accept pre-computed emotion floats"
```

---

## Task 7: Refactor `useEmotionEngine` — main-thread emotion compute + throttled worker post

**Files:**
- Modify: `src/hooks/useEmotionEngine.js`

The hook becomes the single source of truth for emotion values:
1. Adds `pushBlendshapes(blendshapes, audio, rawTimestamp)` called from the FaceLandmarker animation loop in `App.jsx`.
2. Computes raw emotions, applies smoothing (state in a `useRef`), exposes the smoothed values via `emotionsRef`.
3. Throttles `worker.postMessage` to ~100ms.
4. Removes the canvas `ImageBitmap` capture path and the `setInterval` that drove it.

- [ ] **Step 1: Replace `useEmotionEngine.js`**

Replace the file `src/hooks/useEmotionEngine.js` with the version below. Most of the file is unchanged — the changes are: imports for the new module, two new refs (`emotionsRef`, `lastEmotionPostRef`, `smoothedRef`), a new `pushBlendshapes` exported function, and removal of the `startFrameCapture` / `frameIntervalRef` block.

```js
import { useEffect, useRef, useState } from 'react'
import { computeDisfluency } from '../utils/signals'
import { computeEmotions, smoothEmotions } from '../utils/emotionFormulas'

const WORKER_POST_INTERVAL_MS = 100

export function useEmotionEngine({ streamRef, audioLevelRef, currentQuestionTitle, audioThresholdRef }) {
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

  // Emotion pipeline state (main-thread single source of truth)
  const smoothedRef = useRef(null)              // last { smile, fear, anger, contempt, facial_tension } or null at cold start
  const emotionsRef = useRef({ smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 })
  const lastEmotionPostRef = useRef(0)

  const audioFlushIntervalRef = useRef(null)
  const audioContextRef = useRef(null)
  const audioWorkletNodeRef = useRef(null)
  const speechRecognitionRef = useRef(null)

  useEffect(() => {
    const aggregator = new Worker(
      new URL('../workers/aggregatorWorker.js', import.meta.url),
      { type: 'module' },
    )
    aggregatorRef.current = aggregator
    aggregator.onmessage = handleAggregatorMessage
    aggregator.postMessage({ type: 'LOAD_MODELS' })

    const tier2 = new Worker(
      new URL('../workers/tier2Worker.js', import.meta.url),
      { type: 'module' },
    )
    tier2Ref.current = tier2
    tier2.onmessage = handleTier2Message
    tier2.postMessage({ type: 'LOAD_MODELS' })

    return () => {
      aggregator.terminate()
      tier2.terminate()
    }
  }, [])

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
      aggregatorRef.current.postMessage(data)
    }
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
          [data.pcm.buffer],
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
    smoothedRef.current = null
    lastEmotionPostRef.current = 0

    aggregatorRef.current.postMessage({ type: 'START_SESSION', sessionStartTime })

    if (tier2Ready) {
      tier2Ref.current.postMessage({ type: 'START_SESSION', sessionStartTime, currentQuestionTitle })
      setTier2StartOffsetMs(0)
    } else {
      pendingTier2StartRef.current = { sessionStartTime, currentQuestionTitle }
    }
  }

  function startCapture() {
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
          try { recognition.start() } catch (err) { }
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

  /**
   * Called from the FaceLandmarker animation loop in App.jsx.
   * - Computes raw emotions from the blendshape map.
   * - Applies 80/20 smoothing (state in smoothedRef).
   * - Exposes the smoothed values via emotionsRef (read by the stress index updater).
   * - Posts a FRAME_DATA message to the worker, throttled to WORKER_POST_INTERVAL_MS.
   */
  function pushBlendshapes(blendshapes, audio, rawTimestamp) {
    const raw = computeEmotions(blendshapes || {})
    const smoothed = smoothEmotions(smoothedRef.current, raw)
    smoothedRef.current = smoothed
    emotionsRef.current = smoothed

    if (!sessionStartTimeRef.current) return
    if (rawTimestamp - lastEmotionPostRef.current < WORKER_POST_INTERVAL_MS) return
    lastEmotionPostRef.current = rawTimestamp

    aggregatorRef.current?.postMessage({
      type: 'FRAME_DATA',
      emotions: smoothed,
      audio,
      rawTimestamp,
    })
  }

  async function endSession() {
    if (endingRef.current) return endingPromiseRef.current
    endingRef.current = true
    pendingTier2StartRef.current = null

    clearInterval(audioFlushIntervalRef.current)
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

    const tier1Promise = new Promise((resolve) => {
      const handler = (e) => {
        if (e.data?.type === 'FLUSH_COMPLETE') {
          aggregatorRef.current.removeEventListener('message', handler)
          resolve()
        }
      }
      aggregatorRef.current.addEventListener('message', handler)
      aggregatorRef.current.postMessage({ type: 'END_SESSION' })
    })

    const tier2Promise = new Promise((resolve) => {
      const handler = (e) => {
        if (e.data?.type === 'FLUSH_COMPLETE') {
          tier2Ref.current.removeEventListener('message', handler)
          resolve()
        }
      }
      tier2Ref.current.addEventListener('message', handler)
      tier2Ref.current.postMessage({ type: 'END_SESSION' })
    })

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.warn('[endSession] flush timed out after 15s — resolving anyway')
        resolve()
      }, 15000)
    })

    endingPromiseRef.current = Promise.race([
      Promise.all([tier1Promise, tier2Promise]),
      timeoutPromise,
    ]).then(() => ({ signalEvents: signalEventsRef.current }))

    return endingPromiseRef.current
  }

  async function resetEngine() {
    if (endingRef.current && endingPromiseRef.current) {
      try { await endingPromiseRef.current } catch (_) { }
    }
    clearInterval(audioFlushIntervalRef.current)
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
    smoothedRef.current = null
    lastEmotionPostRef.current = 0
    emotionsRef.current = { smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }
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
    pushBlendshapes,
    emotionsRef,
    endSession,
    resetEngine,
    signalEventsRef,
  }
}
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useEmotionEngine.js
git commit -m "refactor(hook): main-thread emotion compute + throttled worker post"
```

---

## Task 8: Wire `App.jsx` — enable blendshapes, time-scaled stress with Δt clamp

**Files:**
- Modify: `src/App.jsx`

Three discrete changes inside `App.jsx`:

1. **Enable blendshapes** on the FaceLandmarker options.
2. **Read blendshapes** in the `detect()` loop and call `pushBlendshapes(...)`.
3. **Time-scaled stress update** with clamped Δt (replaces the `now - lastScoreUpdate.current > 500` block that uses constant rises/decays).

The `useEmotionEngine` hook destructure also needs to add `pushBlendshapes` and `emotionsRef`, and remove the now-unused `canvasRef` argument.

- [ ] **Step 1: Update the hook destructure (where `useEmotionEngine` is called)**

In `src/App.jsx`, find the existing call to `useEmotionEngine`. Before this task it looks roughly like:

```js
const {
  tier1Ready, tier2Ready, tier2StartOffsetMs,
  startSession, startCapture, endSession, resetEngine, signalEventsRef,
} = useEmotionEngine({ streamRef, audioLevelRef, canvasRef, currentQuestionTitle, audioThresholdRef })
```

Replace with:

```js
const {
  tier1Ready, tier2Ready, tier2StartOffsetMs,
  startSession, startCapture, pushBlendshapes, emotionsRef,
  endSession, resetEngine, signalEventsRef,
} = useEmotionEngine({ streamRef, audioLevelRef, currentQuestionTitle, audioThresholdRef })
```

(Note: `canvasRef` is removed from the props passed to the hook. The canvas is still owned by `App.jsx` for the visible landmark overlay; the hook just doesn't need it anymore.)

Add a new ref near the other refs (alongside `audioLevelRef`, `stressRef`, etc.):

```js
const lastStressUpdateRef = useRef(performance.now())
```

- [ ] **Step 2: Enable `outputFaceBlendshapes` in FaceLandmarker options**

Locate the FaceLandmarker creation block (currently around line 205 of App.jsx). Update the options object:

```js
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
```

- [ ] **Step 3: Read blendshapes inside `detect()` and push them through the engine**

Locate the `detect()` function — specifically the block right after `if (results.faceLandmarks?.length > 0) {`. The existing code draws landmarks and computes EAR. Add the blendshape extraction + push immediately after the EAR is computed (roughly after the `const ear = ...` line):

```js
// Build a blendshape name→score map for the first detected face.
const blendshapeMap = {}
const categories = results.faceBlendshapes?.[0]?.categories || []
for (const c of categories) blendshapeMap[c.categoryName] = c.score

// Always update the smoothed emotion state. The hook handles
// throttled forwarding to the worker (only during an active session).
pushBlendshapes(
  blendshapeMap,
  {
    rms: (audioLevelRef.current ?? 0) / 100,
    isSpeaking: (audioLevelRef.current ?? 0) > (audioThresholdRef.current ?? 12),
  },
  performance.now(),
)
```

- [ ] **Step 4: Replace the audio-driven stress block with a time-scaled emotion + audio update**

Find this block in `App.jsx` (inside `updateAudio`):

```js
const now = Date.now()
if (now - lastScoreUpdate.current > 500) {
  lastScoreUpdate.current = now
  setAudioLevel(level)
  if (calibPhaseRef.current === 'ready') {
    setStressScore(prev => {
      const isLoud = level > audioThresholdRef.current + 3
      lastBlinkCountRef.current = blinkCountRef.current
      const rise = isLoud ? 2 + (level / 100) * 1 : 0
      const decay = isLoud ? 1 : 6
      const next = prev + rise - decay
      const result = Math.max(0, Math.min(100, next))
      stressRef.current = result
      return result
    })
  }
}
```

Replace with:

```js
const now = Date.now()
if (now - lastScoreUpdate.current > 500) {
  lastScoreUpdate.current = now
  setAudioLevel(level)
}

if (calibPhaseRef.current === 'ready') {
  // Frame-rate independent stress integration. Δt is clamped at 100ms to
  // prevent tab-throttle / GC pauses from producing artifact spikes.
  const nowPerf = performance.now()
  const dtRaw = nowPerf - lastStressUpdateRef.current
  lastStressUpdateRef.current = nowPerf
  const dt = Math.min(dtRaw, 100)
  const timeScale = dt / 500

  const isLoud   = level > audioThresholdRef.current + 3
  const isSilent = level < audioThresholdRef.current

  const e = emotionsRef.current
  const emotionDelta = e.fear * 4 + e.anger * 3 - e.smile * 3
  const audioDelta   = isLoud ? (2 + (level / 100)) : 0
  const silenceDecay = isSilent ? -6 : (isLoud ? -1 : 0)

  setStressScore(prev => {
    const next = prev + (emotionDelta + audioDelta + silenceDecay) * timeScale
    const result = Math.max(0, Math.min(100, next))
    stressRef.current = result
    return result
  })
}
```

- [ ] **Step 5: Smoke test in the browser**

Run: `npm run dev`

Open the printed URL. In the lobby:
1. Confirm the camera preview shows green landmark dots overlaid on your face.
2. Confirm the console logs `[AggregatorWorker] ARMED` once you press "Start Interview".
3. During the interview, confirm the stress border still pulses and the score moves when you smile (should drop) and when you furrow your brow + frown (should rise gradually).
4. Confirm `console.log` does NOT show any error about `outputFaceBlendshapes`, `RawImage`, or Hugging Face.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): blendshape pipeline + time-scaled stress with Δt clamp"
```

---

## Task 9: Update `reportTimeline.js` to populate emotion + audio fields

**Files:**
- Modify: `src/utils/reportTimeline.js`
- Modify: `src/utils/__tests__/reportTimeline.test.js`

- [ ] **Step 1: Read the existing test file to mirror the style**

Run: `cat src/utils/__tests__/reportTimeline.test.js | head -40`
(For context only — no change in this step.)

- [ ] **Step 2: Add a failing test for emotion + audio fields**

Append this `describe` block to `src/utils/__tests__/reportTimeline.test.js`:

```js
import { buildUnifiedTimeline } from '../reportTimeline.js'

describe('buildUnifiedTimeline — emotion + audio fields', () => {
  it('populates smile/fear/anger/contempt/audio per matched second', () => {
    const sessionData = [
      { time: '00:02', stress: 25 },
      { time: '00:04', stress: 30 },
    ]
    const signalEvents = [{
      id: 'sig-1',
      timestamp: 2000,
      signals: {
        facial_tension: 0.4,
        cadence_gap: false,
        speech_rush: false,
        physical_freeze: false,
        linguistic_disfluency: null,
        smile: 0.1, fear: 0.5, anger: 0.2, contempt: 0.05,
        raw: { audio: { rms: 0.32, isSpeaking: true } },
      },
    }]
    const timeline = buildUnifiedTimeline(sessionData, signalEvents)
    const at2s = timeline.find(p => p.seconds === 2)
    expect(at2s.smile).toBeCloseTo(0.1, 5)
    expect(at2s.fear).toBeCloseTo(0.5, 5)
    expect(at2s.anger).toBeCloseTo(0.2, 5)
    expect(at2s.contempt).toBeCloseTo(0.05, 5)
    expect(at2s.audio).toBeCloseTo(0.32, 5)
  })

  it('keeps emotion/audio fields null when no event covers that second', () => {
    const sessionData = [{ time: '00:00', stress: 10 }]
    const timeline = buildUnifiedTimeline(sessionData, [])
    expect(timeline[0].smile).toBeNull()
    expect(timeline[0].fear).toBeNull()
    expect(timeline[0].audio).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test — expect failures**

Run: `npm test -- src/utils/__tests__/reportTimeline.test.js`
Expected: 2 new tests FAIL.

- [ ] **Step 4: Update `buildUnifiedTimeline`**

In `src/utils/reportTimeline.js`, update `basePoint`:

```js
function basePoint(seconds) {
  return {
    seconds,
    time: formatTime(seconds),
    stress: null,
    facialTension: null,
    smile: null,
    fear: null,
    anger: null,
    contempt: null,
    audio: null,
    pauseMarker: null,
    rushMarker: null,
    freezeMarker: null,
    disfluencyMarker: null,
    tenseDisfluencyMarker: null,
  }
}
```

Then update the `for (const event of signalEvents)` loop in `buildUnifiedTimeline`. Find the block that sets `point.facialTension` and add immediately after it (still inside the same loop iteration):

```js
if (typeof signals.smile    === 'number') point.smile    = signals.smile
if (typeof signals.fear     === 'number') point.fear     = signals.fear
if (typeof signals.anger    === 'number') point.anger    = signals.anger
if (typeof signals.contempt === 'number') point.contempt = signals.contempt
const rms = signals.raw?.audio?.rms
if (typeof rms === 'number') point.audio = rms
```

- [ ] **Step 5: Run the test — expect all pass**

Run: `npm test -- src/utils/__tests__/reportTimeline.test.js`
Expected: All tests PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/utils/reportTimeline.js src/utils/__tests__/reportTimeline.test.js
git commit -m "feat(timeline): expose smile/fear/anger/contempt/audio per point"
```

---

## Task 10: Dual-Y-axis report chart with emotion + audio lines

**Files:**
- Modify: `src/App.jsx`

The existing `<ComposedChart>` in `App.jsx` (the post-session report) plots `stress` and `facialTension` on a single Y-axis, plus discrete event scatter markers. We add a second Y-axis on the right (range 0–1) and 5 new lines: `smile`, `fear`, `anger`, `contempt`, `audio`. The existing stress line stays on the left axis (0–100).

- [ ] **Step 1: Update the `<CustomTooltip>` to format the new fields**

Find the `CustomTooltip` definition near the top of `src/App.jsx`. Inside the `payload.map(...)` block, add new clauses (after the existing `facialTension` clause and before the marker clauses):

```js
if (entry.dataKey === 'fear' && entry.value != null) {
  return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Fear : ${entry.value.toFixed(2)}`}</div>
}
if (entry.dataKey === 'anger' && entry.value != null) {
  return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Anger : ${entry.value.toFixed(2)}`}</div>
}
if (entry.dataKey === 'contempt' && entry.value != null) {
  return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Contempt : ${entry.value.toFixed(2)}`}</div>
}
if (entry.dataKey === 'smile' && entry.value != null) {
  return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Smile : ${entry.value.toFixed(2)}`}</div>
}
if (entry.dataKey === 'audio' && entry.value != null) {
  return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Audio : ${entry.value.toFixed(2)}`}</div>
}
```

- [ ] **Step 2: Add the second Y-axis and the new lines to the report `<ComposedChart>`**

Locate the `<ComposedChart>` JSX in `App.jsx` that consumes `unifiedTimeline` (the post-session report). The existing structure looks like:

```jsx
<ComposedChart data={unifiedTimeline}>
  <CartesianGrid ... />
  <XAxis dataKey="time" ... />
  <YAxis ... />
  <Tooltip content={<CustomTooltip />} />
  <Legend />
  <Line dataKey="stress" ... />
  <Line dataKey="facialTension" ... />
  <Scatter dataKey="pauseMarker" ... />
  ...
</ComposedChart>
```

Replace the `<YAxis>` and `<Line>` block with the dual-axis layout. **Every existing/new `<Line>` and `<Scatter>` must specify `yAxisId`.** Use this exact JSX:

```jsx
<YAxis yAxisId="stress" domain={[0, 100]} />
<YAxis yAxisId="signals" orientation="right" domain={[0, 1]} />
<Tooltip content={<CustomTooltip />} />
<Legend />

<Line yAxisId="stress"  type="monotone" dataKey="stress"        stroke="#d2a630" strokeWidth={2.5} dot={false} name="Stress" />
<Line yAxisId="signals" type="monotone" dataKey="facialTension" stroke="#a371f7" strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="Facial tension" />
<Line yAxisId="signals" type="monotone" dataKey="fear"          stroke="#f85149" strokeWidth={1.5} dot={false} name="Fear" />
<Line yAxisId="signals" type="monotone" dataKey="anger"         stroke="#ff7b72" strokeWidth={1.5} dot={false} name="Anger" />
<Line yAxisId="signals" type="monotone" dataKey="contempt"      stroke="#79c0ff" strokeWidth={1.5} dot={false} name="Contempt" />
<Line yAxisId="signals" type="monotone" dataKey="smile"         stroke="#3fb950" strokeWidth={1.5} dot={false} name="Smile" />
<Line yAxisId="signals" type="monotone" dataKey="audio"         stroke="#58a6ff" strokeWidth={1.5} strokeDasharray="2 2" dot={false} name="Audio level" />
```

Find every existing `<Scatter>` line in this same chart and add `yAxisId="signals"` to it. The scatters use a fixed `MARKER_Y` constant (8, 14, 20, 26, 32) — these were tuned for the old 0–100 scale, but they will need to be normalized for the 0–1 axis. Update `src/utils/reportTimeline.js` first (sub-step below) to scale them:

In `src/utils/reportTimeline.js`, change the `MARKER_Y` constants to 0–1 fractions:

```js
const MARKER_Y = {
  pauseMarker: 0.08,
  rushMarker: 0.14,
  freezeMarker: 0.20,
  disfluencyMarker: 0.26,
  tenseDisfluencyMarker: 0.32,
}
```

(They sit in the 0–0.32 band of the right-side axis.)

The old facialTension multiplied by 100 in `buildUnifiedTimeline` is now wrong — facialTension lives on the 0–1 axis. Find this in `reportTimeline.js`:

```js
if (typeof signals.facial_tension === 'number') {
  const tension = Math.round(signals.facial_tension * 100)
  point.facialTension = Math.max(point.facialTension ?? 0, tension)
}
```

Replace with:

```js
if (typeof signals.facial_tension === 'number') {
  const tension = signals.facial_tension
  point.facialTension = Math.max(point.facialTension ?? 0, tension)
}
```

- [ ] **Step 3: Update related test — the existing reportTimeline tests likely assume the *100 scaling**

Run: `npm test -- src/utils/__tests__/reportTimeline.test.js`

If any tests fail, they will be ones referring to `facialTension` as an integer 0–100. Update those tests to expect a 0–1 fraction. Example fix pattern:

```js
// before
expect(point.facialTension).toBe(70)
// after
expect(point.facialTension).toBeCloseTo(0.7, 5)
```

- [ ] **Step 4: Update the existing `facialTension` tooltip clause**

In `App.jsx`'s `CustomTooltip`, the existing clause does `Math.round(entry.value)` and shows it as an integer. Update it to format as a 0–1 percentage:

```js
if (entry.dataKey === 'facialTension' && entry.value != null) {
  return <div key={index} style={{ color: entry.color, marginTop: 4 }}>{`Facial tension : ${Math.round(entry.value * 100)}%`}</div>
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 6: Smoke test in the browser**

Run: `npm run dev`

1. Complete a short session (calibrate, talk and code for ~30 seconds, end session).
2. On the report screen, confirm:
   - The amber stress line is on the left, scaling 0–100.
   - The four emotion lines (red/orange/blue/green) are visible on the right axis at recognizable scales.
   - The blue dotted audio line moves with your voice.
   - Hovering the chart shows all values in the tooltip.
   - Event scatter markers (pause, rush, freeze, disfluency) still appear in their dedicated row near the bottom.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/utils/reportTimeline.js src/utils/__tests__/reportTimeline.test.js
git commit -m "feat(report): dual Y-axis chart with emotion + audio lines"
```

---

## Task 11: Final cleanup — remove dead Hugging Face dependency reference (optional)

**Files:**
- Read: `package.json`

The `@huggingface/transformers` package is still used by `tier2Worker.js` for Whisper, so we must NOT remove it from `package.json`. This task is just a verification.

- [ ] **Step 1: Confirm tier2Worker still uses transformers**

Run: `grep -n "huggingface\|transformers" src/workers/tier2Worker.js`
Expected: At least one match showing the import is still there.

If zero matches, the dependency is unused and can be removed; otherwise leave `package.json` alone.

- [ ] **Step 2: No commit needed**

---

## Self-Review Checklist (run before handing off)

- [ ] Every spec section is implemented:
  - Architecture data flow → Tasks 6 + 7 + 8
  - Files Changed table → Tasks 4–10 cover all 5 listed files
  - Emotion formulas → Task 2
  - Smoothing → Task 3
  - Stress index integration with Δt clamp → Task 8
  - Signal schema → Task 4
  - Report chart dual Y-axis → Task 10
- [ ] No "TBD" / "TODO" / "implement later" strings in this plan.
- [ ] Type consistency:
  - `pushBlendshapes(blendshapes, audio, rawTimestamp)` matches between Task 7 (definition) and Task 8 (call site).
  - `emotionsRef.current` shape `{ smile, fear, anger, contempt, facial_tension }` matches between Task 7 (writer) and Task 8 (reader).
  - Worker `FRAME_DATA` payload `{ emotions, audio, rawTimestamp }` matches between Task 6 (handler) and Task 7 (sender).
- [ ] Bilateral averaging fix applied in Task 2 formulas.
- [ ] Δt clamp `Math.min(dt, 100)` applied in Task 8.
- [ ] Dual Y-axis explicit in Task 10 with `yAxisId="stress"` and `yAxisId="signals"`.
- [ ] `MARKER_Y` constants rescaled to the 0–1 band in Task 10.
