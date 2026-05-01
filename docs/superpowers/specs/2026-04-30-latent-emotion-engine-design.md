# CogniFlow — Latent Emotion Engine

**Design Specification — Sub-project A**

| Field | Value |
|---|---|
| Date | 2026-04-30 |
| Status | Locked, ready for implementation planning |
| Sub-project | A — The "Sensor" layer |
| Depends on | Existing CogniFlow Weeks 1–6 codebase |
| Blocks | Sub-project C (Contextual Transcription & Alignment), then Sub-project B (Behavioral Transparency UI) |

---

## 1. Overview

The Latent Emotion Engine is the first sub-project in a three-part evolution of CogniFlow. It introduces a parallel signal pipeline that augments — but does not replace — the existing audio + blink stress fusion model. The engine produces a timestamped stream of behavioral micro-signals derived from facial expression recognition (FER), voice cadence analysis, and (via Sub-project C) speech transcription.

**Why this evolution.** Peer feedback flagged the single `stressScore` percentage as too coarse: "anxiety" is an umbrella label that obscures the specific behavioral patterns it summarizes. By producing explainable, named signals (`facial_tension`, `cadence_gap`, `physical_freeze`, `linguistic_disfluency`) the system becomes legible to the user during reflection — addressing the reductive-metric critique while preserving the ipsative fairness principle from the original proposal.

**Three-part decomposition.**

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ A — The Sensor      │ →  │ C — The Interpreter │ →  │ B — The Coach       │
│                     │    │                     │    │                     │
│ FER + audio cadence │    │ Whisper transcription│    │ Behavioral UI       │
│ Aggregator buffer   │    │ Topic tagging        │    │ Aftercare module    │
│ Signal stream out   │    │ Word-level alignment │    │ Ipsative calibration │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
       (this spec)              (Sub-project C)             (Sub-project B)
```

This document specifies Sub-project A only. Sub-project A includes a working Tier 2 Whisper Worker that produces basic topic tags; Sub-project C will extend it with sophisticated semantic alignment.

---

## 2. Scope

### In scope (Sub-project A)

- Web Worker architecture for FER and Whisper-tiny model hosting
- Two-tier signal pipeline: real-time (Tier 1) and buffered (Tier 2)
- A deterministic Latent Layer (Aggregator) that fuses tiers using a sliding-window buffer with finalization rules
- Master Session Clock protocol for cross-thread timestamp normalization
- The `useEmotionEngine` React hook providing a clean integration boundary
- Additive integration with `App.jsx` — no regression on existing `stressScore`, blink, or Recharts behaviour
- Coexistence constraints: hard reset, idempotent flush, late Tier 2 attachment, UI-safe payload projection

### Out of scope (deferred to later sub-projects)

- The Behavioral Transparency UI itself (Signals view, Aftercare module, Ipsative calibration display) — Sub-project B
- Sophisticated topic extraction and word-level signal alignment — Sub-project C
- Replacing the existing `stressScore` fusion algorithm — V2 consideration
- Persistent storage of session events across page reloads — V2
- Mobile / non-desktop layouts — out of scope for the prototype overall

### Explicit non-goals

- The engine does **not** replace MediaPipe or the existing AudioContext analyser. Both continue to drive the live UI exactly as today.
- The engine does **not** display anything to the user in V1. Its output is consumed by Sub-project B's UI components.

---

## 3. Architecture

### 3.1 Component Map

```
MAIN THREAD (App.jsx)
│
├── [existing]  MediaPipe FaceLandmarker        EAR + blink detection (RAF loop)
├── [existing]  AudioContext + AnalyserNode     RMS for live audioLevel state
│
├── [new]       useEmotionEngine hook
│               └── owns AudioWorklet (separate context on same MediaStream)
│               └── owns Worker lifecycle, message routing, refs, intervals
│
├── [new] ────► AggregatorWorker (Tier 1)
│               └── Xenova/facial-expression-recognition (MobileNet, ~9MB)
│               └── Cadence state machine (cadence_gap, speech_rush)
│               └── Sliding buffer + finalization pass
│               └── Receives FRAME_DATA + TRANSCRIPT_CHUNK (relayed)
│               └── Emits SIGNAL_EVENT, FLUSH_COMPLETE
│
└── [new] ────► Tier2Worker
                └── Xenova/whisper-tiny (~75MB)
                └── PCM chunking (3–5s windows)
                └── Basic topic tagging (V1: question-title-based)
                └── Disfluency scoring (token-based filler/hedge counting)
                └── Emits TRANSCRIPT_CHUNK, FLUSH_COMPLETE → main relays to Tier 1
```

### 3.2 New Files

```
cogniflow/
├── src/
│   ├── App.jsx                          ← MODIFIED (six additive edits)
│   ├── hooks/
│   │   └── useEmotionEngine.js          ← NEW
│   └── workers/
│       ├── aggregatorWorker.js          ← NEW (Tier 1)
│       ├── tier2Worker.js               ← NEW (Whisper)
│       └── pcmCaptureProcessor.js       ← NEW (AudioWorklet processor)
└── ...
```

No changes to `vite.config.js`, `questions.js`, `main.jsx`, `App.css`, `package.json` — apart from the necessary dependency `@xenova/transformers` (or `@huggingface/transformers`).

### 3.3 Communication Topology

Worker-to-Worker communication uses **Option A: Main thread relay** for V1. The main thread does no work in the relay path beyond forwarding Tier 2's `TRANSCRIPT_CHUNK` messages to the AggregatorWorker. This was chosen over `MessageChannel` for debuggability — every message is observable in main-thread devtools — at the cost of negligible overhead given the 3–5 second Tier 2 fire rate.

The hook interface is transport-agnostic: replacing the relay with `MessageChannel` in V2 requires changes only inside `useEmotionEngine.js`.

---

## 4. Signal Schema

### 4.1 The `SignalEvent` Type

```typescript
interface SignalEvent {
  id: string                          // `sig-${sequenceNum}`
  timestamp: number                   // ms since session start (canonical, relative)
  finalized: boolean                  // always true on emission to main thread

  signals: {
    // Derived layer — minimal named markers, each with a 1:1 Aftercare mapping
    facial_tension:        number          // 0–1
    cadence_gap:           boolean
    speech_rush:           boolean
    physical_freeze:       boolean
    linguistic_disfluency: number | null   // null until Tier 2 backfill arrives

    // Raw layer — preserved for V2 expressive-signal expansion, never displayed in V1
    raw: {
      fer: {
        neutral: number; happy: number; sad: number
        angry: number; fearful: number; disgusted: number; surprised: number
      }
      audio: {
        rms:        number   // 0–1 normalized
        isSpeaking: boolean  // VAD result
      }
    }
  }

  context: {
    text:       string   // Whisper transcript chunk text
    topic:      string   // V1: question title; Sub-project C: extracted phase tag
    chunkStart: number   // ms since session start
    chunkEnd:   number
  } | null              // null until Tier 2 backfill arrives
}
```

### 4.2 Derived Signal Definitions

#### `facial_tension` — fear-dominant facial stress (0–1)

```js
facial_tension = clamp(
  fer.fearful * 0.6 + fer.angry * 0.3 + fer.disgusted * 0.1,
  0, 1
)
```

| Range | Interpretation |
|---|---|
| `< 0.30` | Baseline / neutral |
| `0.30–0.59` | Moderate tension |
| `≥ 0.60` | Significant tension spike |

Weights chosen to reflect interview-context stress markers: fear dominates (cognitive overload), anger captures concentration-related brow furrow, disgust adds trace weight for strong aversion.

#### `cadence_gap` and `speech_rush` — single state machine (booleans)

These two signals share the same `lastSilenceStartRaw` state and must be computed together to avoid order-of-operations bugs (resetting state before reading it):

```js
const GAP_THRESHOLD_MS   = 1_500
const RUSH_RMS_THRESHOLD = 0.65

// AggregatorWorker module state
let lastSilenceStartRaw = null

function updateCadenceState(audio, rawTimestamp) {
  let cadence_gap, speech_rush

  if (!audio.isSpeaking) {
    if (lastSilenceStartRaw === null) lastSilenceStartRaw = rawTimestamp
    cadence_gap = (rawTimestamp - lastSilenceStartRaw) > GAP_THRESHOLD_MS
    speech_rush = false
  } else {
    // Read state BEFORE resetting it
    const wasGapped = lastSilenceStartRaw !== null &&
                      (rawTimestamp - lastSilenceStartRaw) > GAP_THRESHOLD_MS
    cadence_gap = false
    speech_rush = wasGapped && audio.rms > RUSH_RMS_THRESHOLD
    lastSilenceStartRaw = null   // reset AFTER computing speech_rush
  }

  return { cadence_gap, speech_rush }
}
```

`cadence_gap` = sustained silence (>1.5s) during active explanation; single-tick silences are normal thinking pauses.

`speech_rush` = the classic anxiety-rebound pattern: silence → high-energy verbal burst the tick speech resumes.

#### `physical_freeze` — composite freeze-response state (boolean)

```js
const FREEZE_TENSION_MIN   = 0.50
const FREEZE_SILENCE_FLOOR = 0.05
const FREEZE_MIN_TICKS     = 2

const condition =
  facial_tension > FREEZE_TENSION_MIN &&
  cadence_gap === true                &&
  audio.rms < FREEZE_SILENCE_FLOOR

consecutiveFreezeCount = condition ? consecutiveFreezeCount + 1 : 0
physical_freeze = consecutiveFreezeCount >= FREEZE_MIN_TICKS
```

Tracked as a tick-stream property (state). Two-tick guard (~1000ms) prevents false positives from normal thinking pauses with neutral facial expression. Sub-project B may derive freeze-start / freeze-end transitions from this stream without modifying the base event model.

#### `linguistic_disfluency` — filler + hedge density (0–1, backfilled)

Computed by Tier2Worker from each Whisper transcript chunk:

```js
const FILLERS      = ['um','uh','like','you know','basically','sort of','kind of']
const HEDGE_PHRASES = ["i think","maybe","perhaps","i'm not sure","probably","i guess"]

function computeDisfluency(text) {
  const tokens = text.toLowerCase().match(/\b\w+\b/g) ?? []
  if (tokens.length === 0) return 0

  // Token-level matching for single-word fillers (avoids "like" inside "alike")
  const fillerCount = tokens.filter(t => FILLERS.includes(t)).length

  // Substring matching for multi-word phrases (which can't be word-tokenized)
  const lowered = text.toLowerCase()
  const hedgeCount = HEDGE_PHRASES.filter(p => lowered.includes(p)).length

  // Normalize per 10 words; hedges weighted half — softer signal than fillers
  return clamp((fillerCount + hedgeCount * 0.5) / (tokens.length / 10), 0, 1)
}
```

Backfilled onto SignalEvents within the chunk's `[start, end]` timestamp range — see §7.4.

### 4.3 Why Exactly These Four Signals

Each derived signal maps 1:1 to a specific Aftercare action defined in Sub-project B. Adding a fifth would either duplicate an existing mapping or violate the zero-extraneous-load principle:

| Signal | Elevated reading means | Aftercare trigger |
|---|---|---|
| `facial_tension` | Face showing fear/anger markers | Jaw release / grounding prompt |
| `cadence_gap` | Went silent mid-explanation | "Silence is okay — pause and breathe" |
| `physical_freeze` | Body locked up (silence + tension) | Freeze-response reframe prompt |
| `linguistic_disfluency` | Hedging / filler word spike | Slow deliberate speech suggestion |

`speech_rush` is a state property used by the Aggregator; it does not have a dedicated Aftercare action in V1.

---

## 5. Worker Lifecycle

### 5.1 State Machines

```
AggregatorWorker:
  IDLE ──LOAD_MODELS──►  LOADING ──model loaded, post WORKER_READY──►  READY
  READY ──START_SESSION──►  ARMED       (stores sessionStartTime; no emission yet)
  ARMED ──first FRAME_DATA──►  RUNNING  (emitting SignalEvents)
  RUNNING ──END_SESSION──►  FLUSHING    (finalizes all buffer, BUFFER_WINDOW_MS lifted)
  FLUSHING ──post FLUSH_COMPLETE──►  IDLE
  any state ──RESET──►  IDLE            (clears buffer, sequenceNum, refs)

Tier2Worker:
  IDLE ──LOAD_MODELS──►  LOADING ──model loaded, post WORKER_READY──►  READY
  READY ──START_SESSION──►  BUFFERING        (accumulating PCM)
  BUFFERING ──AUDIO_CHUNK──►  INFERRING ──►  BUFFERING (loop)
  BUFFERING ──END_SESSION──►  FLUSHING       (process partial PCM, post final TRANSCRIPT_CHUNK)
  FLUSHING ──post FLUSH_COMPLETE──►  IDLE
  any state ──RESET──►  IDLE                 (clears PCM buffer)
```

### 5.2 Message Protocol

**Main thread → AggregatorWorker:**

| Message | Payload | Effect |
|---|---|---|
| `LOAD_MODELS` | — | Begin model load; reply `WORKER_READY` when complete |
| `START_SESSION` | `{ sessionStartTime: number }` | Store `sessionStartTime` (raw `performance.now()` from main thread); transition READY → ARMED |
| `FRAME_DATA` | `{ frame: ImageBitmap, audio: { rms, isSpeaking }, rawTimestamp }` | Run FER, derive signals, push to buffer, run finalization pass |
| `TRANSCRIPT_CHUNK` | `{ start, end, topic, text, disfluency }` | Backfill matching unfinalized events |
| `END_SESSION` | — | Apply queued backfill, finalize all events regardless of age, post `FLUSH_COMPLETE` |
| `RESET` | — | Drop buffer and all internal state; return to IDLE |

**Main thread → Tier2Worker:**

| Message | Payload | Effect |
|---|---|---|
| `LOAD_MODELS` | — | Begin Whisper-tiny load; reply `WORKER_READY` when complete |
| `START_SESSION` | `{ sessionStartTime, currentQuestionTitle }` | Reset PCM buffer, store anchors |
| `AUDIO_CHUNK` | `{ pcmData: Float32Array, audioContextTime, wallTime }` | Run Whisper, post `TRANSCRIPT_CHUNK` |
| `END_SESSION` | — | Process any partial PCM, post final `TRANSCRIPT_CHUNK`, post `FLUSH_COMPLETE` |
| `RESET` | — | Drop PCM buffer; return to IDLE |

**AggregatorWorker → Main thread:**

| Message | Payload |
|---|---|
| `WORKER_READY` | — |
| `SIGNAL_EVENT` | `{ event: SignalEvent }` (one per emission) |
| `FLUSH_COMPLETE` | `{ source: 'tier1' }` |

**Tier2Worker → Main thread:**

| Message | Payload |
|---|---|
| `WORKER_READY` | — |
| `TRANSCRIPT_CHUNK` | `{ start, end, topic, text, disfluency }` (relayed by main thread to AggregatorWorker) |
| `FLUSH_COMPLETE` | `{ source: 'tier2' }` |

---

## 6. Initialization Sequence

### 6.1 Approach: Lobby Warmup (eager)

Workers are created when the Lobby mounts, in parallel with the existing camera startup. By the time the user has read the question and is ready to click Start, both workers have loaded their models. First-visit cost (~5–15 seconds for Whisper-tiny) is hidden behind reading time; subsequent visits hit the browser cache (~1 second).

```
══ LOBBY MOUNTS ══════════════════════════════════════════════════════════

  App.jsx renders, calls useEmotionEngine
  ├── new Worker('./workers/aggregatorWorker.js')
  │       postMessage({ type: 'LOAD_MODELS' })
  │       on WORKER_READY → setTier1Ready(true)
  │
  └── new Worker('./workers/tier2Worker.js')
          postMessage({ type: 'LOAD_MODELS' })
          on WORKER_READY → setTier2Ready(true)

  [concurrent — existing logic, untouched]
  startCamera() → setCameraReady(true)

  Start button gated on:  cameraReady && tier1Ready
                          (Tier 2 attaches when ready — see §10.2)
  Lobby UI states:
    !cameraReady             → "Loading camera..."
    !tier1Ready              → "Preparing AI models..."
    cameraReady & tier1Ready → "Start Interview" (enabled)

══ START CLICK ═══════════════════════════════════════════════════════════

  const sessionStartTime = performance.now()

  startSession(sessionStartTime)
  ├── tier1Worker.postMessage({ type: 'START_SESSION', sessionStartTime })
  ├── if (tier2Ready)
  │       tier2Worker.postMessage({ type: 'START_SESSION', sessionStartTime, currentQuestionTitle })
  │   else
  │       pendingTier2StartRef.current = { sessionStartTime, currentQuestionTitle }
  ├── start FRAME_DATA interval (500ms)
  └── start AudioWorklet PCM accumulator + AUDIO_CHUNK flush interval (4000ms)

  [existing — untouched]
  setCalibPhase('calibrating')
  calibStartRef.current = Date.now()
  setPhase('CALIBRATING')

  Workers receive START_SESSION → store sessionStartTime, transition to ARMED.
  AggregatorWorker does NOT emit during CALIBRATING — it transitions to RUNNING
  on receipt of the first FRAME_DATA message, which only begins flowing once
  the existing calibration completes (see §6.2).

══ CALIBRATION COMPLETE → INTERVIEWING ═══════════════════════════════════

  [existing] phase = 'INTERVIEWING'

  FRAME_DATA + AUDIO_CHUNK streams begin flowing. Workers emit signals.
  See §7 for tick cycle details.

══ END_SESSION ═══════════════════════════════════════════════════════════

  See §8 for the full flush ordering protocol.
```

### 6.2 FRAME_DATA Capture

A 500ms interval started on session start captures a frame from the existing canvas (the same canvas MediaPipe draws to) as a transferable `ImageBitmap`:

```js
const interval = setInterval(async () => {
  const frame = await createImageBitmap(canvasRef.current)
  aggregatorWorker.postMessage(
    {
      type: 'FRAME_DATA',
      frame,
      audio: {
        rms:        audioLevelRef.current / 100,    // normalize 0–100 → 0–1
        isSpeaking: audioLevelRef.current > 5,
      },
      rawTimestamp: performance.now(),
    },
    [frame]   // transfer ownership — zero copy
  )
}, 500)
```

The interval starts only after `setPhase('INTERVIEWING')`. During CALIBRATING, no FRAME_DATA is sent and the AggregatorWorker remains in ARMED state. This keeps calibration single-purpose (EAR baseline only).

### 6.3 AUDIO_CHUNK Capture

An `AudioWorklet` (in `pcmCaptureProcessor.js`) attached to a separate AudioContext on the same MediaStream accumulates raw PCM into a ring buffer. Every 4 seconds, the buffer is flushed:

```js
// AudioWorklet posts to main thread every 4s with the accumulated buffer
audioWorkletNode.port.onmessage = ({ data }) => {
  if (data.type !== 'PCM_FLUSH') return
  tier2Worker.postMessage(
    {
      type:             'AUDIO_CHUNK',
      pcmData:          data.pcm,
      audioContextTime: audioContext.currentTime,
      wallTime:         performance.now() - sessionStartTime,
    },
    [data.pcm.buffer]
  )
}
```

The separate AudioContext is intentional: it isolates the PCM extraction pipeline from the existing analyser-based RMS computation, eliminating any risk of regression on the live `audioLevel` indicator.

### 6.4 Tier 2 Relay

```js
tier2Worker.onmessage = ({ data }) => {
  if (data.type === 'WORKER_READY') {
    setTier2Ready(true)
    // Late-attach: if a session already started, send queued START_SESSION
    if (pendingTier2StartRef.current) {
      tier2Worker.postMessage({ type: 'START_SESSION', ...pendingTier2StartRef.current })
      pendingTier2StartRef.current = null
    }
  } else if (data.type === 'TRANSCRIPT_CHUNK') {
    aggregatorWorker.postMessage(data)   // relay verbatim
  } else if (data.type === 'FLUSH_COMPLETE') {
    // see §8 — triggers Tier 1 END_SESSION
  }
}
```

---

## 7. Aggregator Internals

### 7.1 Master Session Clock Protocol

Timestamps in the system flow through three forms:

1. **Raw `performance.now()` on main thread** — captured at FRAME_DATA send time, attached as `rawTimestamp`.
2. **Inside the Worker** — events store `rawTimestamp` (absolute) for buffer comparisons and finalization age checks.
3. **On emission to main thread** — `rawTimestamp` is stripped; only `timestamp = rawTimestamp - sessionStartTime` (relative ms since session start) is exposed.

This gives a **single timing authority** (main thread `performance.now()`) and a **canonical session timeline** (relative to `sessionStartTime`). Modern browsers share the same high-resolution time origin across main thread and Workers, so cross-thread `performance.now()` differences are below the ~500ms tick resolution and can be ignored.

### 7.2 Buffer Structure

```js
// AggregatorWorker internal state
let buffer                    = []      // SignalEvent[], unfinalized only
let sessionStartTime          = null
let sequenceNum               = 0
let consecutiveFreezeCount    = 0
let lastSilenceStartRaw       = null
let inferenceInFlight         = false   // single-flight guard (§7.5 G1)

const BUFFER_WINDOW_MS = 10_000
const TICK_INTERVAL_MS = 500
```

Memory bound: ~20 events maximum (10s window ÷ 500ms ticks), each ~200 bytes including raw FER probabilities. Total <5KB.

### 7.3 Tick Cycle (on FRAME_DATA)

```js
self.onmessage = async ({ data }) => {
  if (data.type !== 'FRAME_DATA') { /* handle other messages */ return }

  // Guard 1: single in-flight FER inference — drop if busy
  if (inferenceInFlight) { data.frame.close(); return }
  inferenceInFlight = true

  try {
    const tickNow = data.rawTimestamp   // Guard 2: single clock per tick

    // 1. FER inference
    const fer = await runFER(data.frame)
    data.frame.close()

    // 2. Derive signals
    const facial_tension = clamp(fer.fearful * 0.6 + fer.angry * 0.3 + fer.disgusted * 0.1, 0, 1)
    const { cadence_gap, speech_rush } = updateCadenceState(data.audio, tickNow)
    const condition = facial_tension > 0.5 && cadence_gap && data.audio.rms < 0.05
    consecutiveFreezeCount = condition ? consecutiveFreezeCount + 1 : 0
    const physical_freeze = consecutiveFreezeCount >= 2

    // 3. Build event
    const event = {
      id:           `sig-${sequenceNum++}`,
      rawTimestamp: tickNow,                        // internal, stripped on emit
      timestamp:    tickNow - sessionStartTime,     // canonical, relative
      finalized:    false,
      signals: {
        facial_tension, cadence_gap, speech_rush, physical_freeze,
        linguistic_disfluency: null,
        raw: { fer, audio: data.audio },
      },
      context: null,
    }

    // Guard 4: monotonic timestamp assertion (dev-only)
    if (import.meta.env?.DEV && buffer.length > 0) {
      const prev = buffer[buffer.length - 1]
      console.assert(
        tickNow >= prev.rawTimestamp,
        `[AggregatorWorker] Monotonicity violated: ${tickNow} < ${prev.rawTimestamp}`
      )
    }

    buffer.push(event)

    // 4. Finalization pass — using the same tickNow
    runFinalizationPass(tickNow)
  } finally {
    inferenceInFlight = false
  }
}
```

### 7.4 Finalization Pass

```js
function runFinalizationPass(tickNow) {
  const ready = buffer.filter(e => (tickNow - e.rawTimestamp) > BUFFER_WINDOW_MS)

  for (const event of ready) {
    event.finalized = true
    const { rawTimestamp, ...emittable } = event   // strip internal field
    self.postMessage({ type: 'SIGNAL_EVENT', event: emittable })
  }

  buffer = buffer.filter(e => !e.finalized)
}
```

Events are emitted in chronological order (insertion order, guaranteed by Guard 1). The `rawTimestamp` field never crosses the Worker boundary.

### 7.5 Backfill (TRANSCRIPT_CHUNK)

```js
function handleTranscriptChunk({ start, end, topic, text, disfluency }) {
  const absStart = sessionStartTime + start
  const absEnd   = sessionStartTime + end

  for (const event of buffer) {
    if (event.rawTimestamp < absStart || event.rawTimestamp > absEnd) continue

    // Guard 3: first-write-wins — only set if currently null
    if (event.signals.linguistic_disfluency !== null) continue

    event.signals.linguistic_disfluency = disfluency
    event.context = { text, topic, chunkStart: start, chunkEnd: end }
  }

  // Events already finalized (and removed from buffer) are silently skipped.
  // This is expected when Whisper inference latency approaches BUFFER_WINDOW_MS.
}
```

**Late-drop tolerance:** Whisper-tiny averages ~3s inference on 4s audio. Buffer holds events for 10s. Margin is ~3–4s — sufficient under normal load.

### 7.6 Edge-Case Guards (Locked)

| # | Guard | Purpose |
|---|---|---|
| G1 | Single in-flight FER inference; drop frames if busy | Prevent timestamp reordering under load spikes |
| G2 | One clock per tick (`tickNow = data.rawTimestamp`) | Eliminate cross-thread / within-tick drift |
| G3 | Backfill first-write-wins (only set if `null`) | Handle overlapping chunks deterministically |
| G4 | Dev-only monotonicity assertion | Validate the invariant Guard 1 establishes |
| G5 | Drift clamp ±500ms in Tier 2 timestamp correction | Prevent a single bad chunk from misaligning context |

### 7.7 Audio Drift Correction

Per-chunk anchoring inside Tier2Worker:

```js
const DRIFT_CLAMP_MS = 500

function correctChunkTimestamps(chunk, audioContextTime, wallTime) {
  const audioMs   = audioContextTime * 1000
  const rawDrift  = wallTime - audioMs
  const driftMs   = Math.max(-DRIFT_CLAMP_MS, Math.min(DRIFT_CLAMP_MS, rawDrift))

  return {
    start: chunk.startMsInAudio + driftMs,
    end:   chunk.endMsInAudio   + driftMs,
  }
}
```

Audio drift is computed fresh on every AUDIO_CHUNK rather than on a periodic recalibration interval. This makes drift correction stateless and per-chunk-deterministic, with the ±500ms clamp preventing pathological chunks from poisoning the alignment.

---

## 8. END_SESSION Flush Ordering

```
endSession() called by handleEndSession
│
├── Idempotency check: if already flushing, return existing promise (Constraint #3)
│
├── Stop FRAME_DATA interval
├── Stop AUDIO_CHUNK flush interval
│
├── tier2Worker.postMessage({ type: 'END_SESSION' })
│   │
│   └── Tier2Worker FLUSHING:
│       ├── run Whisper on remaining partial PCM
│       ├── postMessage(TRANSCRIPT_CHUNK)        ← main relays to AggregatorWorker
│       └── postMessage(FLUSH_COMPLETE, source: 'tier2')
│
├── Main receives TRANSCRIPT_CHUNK → aggregator.postMessage(data)
│
├── Main receives FLUSH_COMPLETE source=tier2
│   └── aggregatorWorker.postMessage({ type: 'END_SESSION' })
│       │
│       └── AggregatorWorker FLUSHING:
│           ├── Worker message queue is FIFO — TRANSCRIPT_CHUNK already applied
│           ├── finalize ALL remaining buffer events (BUFFER_WINDOW_MS lifted)
│           ├── emit each as SIGNAL_EVENT
│           └── postMessage(FLUSH_COMPLETE, source: 'tier1')
│
└── Main receives FLUSH_COMPLETE source=tier1
    └── resolve endSession() promise
        → handleEndSession proceeds to compute reportData
```

The ordering guarantees the final transcript chunk is applied to the buffer before AggregatorWorker performs its terminal finalization, because Worker message queues are FIFO: a `TRANSCRIPT_CHUNK` posted before `END_SESSION` is dequeued and processed first.

---

## 9. Integration with App.jsx

### 9.1 The `useEmotionEngine` Hook

```js
const {
  // Readiness
  tier1Ready,           // boolean — gates Start button
  tier2Ready,           // boolean — informational, never blocks
  tier2StartOffsetMs,   // number | null — see Constraint #2

  // Session control
  startSession,         // (sessionStartTime: number) => void
  endSession,           // () => Promise<void> — idempotent, resolves after both flushes
  resetEngine,          // () => void — absolute system reset

  // Output
  signalEventsRef,      // Ref<SignalEvent[]> — full-fidelity stream (internal)
} = useEmotionEngine({
  streamRef,            // existing — MediaStream from getUserMedia
  audioLevelRef,        // existing — for FRAME_DATA's audio.rms
  canvasRef,            // existing — frame source for FER capture
  currentQuestionTitle, // existing — passed to Tier2Worker as V1 topic seed
})
```

### 9.2 App.jsx Edits — Six Total

**Edit 1 — Hook instantiation:**
```jsx
const {
  tier1Ready, tier2Ready, tier2StartOffsetMs,
  startSession, endSession, resetEngine,
  signalEventsRef,
} = useEmotionEngine({
  streamRef, audioLevelRef, canvasRef,
  currentQuestionTitle: currentQuestion.title,
})
```

**Edit 2 — `handleStartInterview` gate tightened, two new calls:**
```js
function handleStartInterview() {
  if (startingRef.current || !cameraReady || !tier1Ready) return  // CHANGED
  startingRef.current = true

  const sessionStartTime = performance.now()                      // NEW
  startSession(sessionStartTime)                                  // NEW

  setCalibPhase('calibrating')
  calibPhaseRef.current = 'calibrating'
  calibStartRef.current = Date.now()
  setPhase('CALIBRATING')
}
```

**Edit 3 — `handleEndSession` becomes async:**
```js
async function handleEndSession() {
  setEndingSession(true)                              // NEW
  await endSession()                                  // NEW (idempotent)
  setEndingSession(false)                             // NEW

  const data = sessionDataRef.current
  if (data.length === 0) {
    setReportData({ empty: true })
  } else {
    const avgStress   = Math.round(data.reduce((s, d) => s + d.stress, 0) / data.length)
    const peakStress  = data.reduce((m, d) => Math.max(m, d.stress), 0)
    const peakEntry   = data.find(d => d.stress === peakStress)
    const peakTime    = peakEntry?.time ?? '--:--'
    const totalBlinks = blinkCountRef.current
    const duration    = formatTime(sessionTimeRef.current)

    setReportData({
      // legacy fields, unchanged
      avgStress, peakStress, peakTime, totalBlinks, duration,
      sessionData: [...data],
      // new — additive
      signalEvents: [...signalEventsRef.current],     // NEW
      tier2StartOffsetMs,                             // NEW (Constraint #2)
    })
  }
  setPhase('REPORT')
}
```

**Edit 4 — `handleNewSession` becomes async, gains one awaited call:**
```js
async function handleNewSession() {                 // CHANGED: async (race guard)
  await resetEngine()                               // NEW (Constraint #1 — awaits any active flush)
  // ... all existing resets, unchanged ...
  setPhase('LOBBY')
}
```

**Edit 5 — Start button gate + label:**
```jsx
<button
  onClick={handleStartInterview}
  disabled={!cameraReady || !!cameraError || !tier1Ready}
  ...
>
  {!cameraReady   ? 'Loading camera...'
  : !tier1Ready   ? 'Preparing AI models...'
  :                 'Start Interview'}
</button>
```

**Edit 6 — End Session button disabled while flushing:**
```jsx
<button onClick={handleEndSession} disabled={endingSession} ...>
  {endingSession ? 'Processing…' : 'End Session'}
</button>
```

### 9.3 No-Regression Contract

| Subsystem | Owner | Status |
|---|---|---|
| `getUserMedia` + camera setup | App.jsx (existing useEffect) | Untouched |
| MediaPipe FaceLandmarker | App.jsx | Untouched |
| EAR-based blink detection | App.jsx | Untouched |
| AudioContext + AnalyserNode (live RMS) | App.jsx | Untouched |
| `stressScore` fusion algorithm | App.jsx | Untouched |
| 2-second `sessionDataRef` logging | App.jsx | Untouched |
| Live header (Blinks, Stress%, timer) | App.jsx | Untouched |
| Recharts stress timeline in Report Card | App.jsx | Untouched |
| FRAME_DATA capture (500ms) | useEmotionEngine | Net new |
| AudioWorklet PCM extraction | useEmotionEngine | Net new (separate AudioContext) |
| Workers (Aggregator, Tier 2) | useEmotionEngine | Net new |

If `useEmotionEngine` were stubbed to return `{ tier1Ready: true, signalEventsRef: { current: [] }, ... }` with no-op session control, App.jsx behaviour would be identical to the current Week 6 implementation.

### 9.4 `reportData` Shape Evolution

```typescript
// Today
interface ReportData {
  empty?:      true
  avgStress:   number
  peakStress:  number
  peakTime:    string
  totalBlinks: number
  duration:    string
  sessionData: Array<{ time, stress, blinks, audioLevel }>
}

// After Sub-project A
interface ReportData {
  empty?:      true
  // existing — unchanged
  avgStress:   number
  peakStress:  number
  peakTime:    string
  totalBlinks: number
  duration:    string
  sessionData: Array<{ time, stress, blinks, audioLevel }>
  // new — additive
  signalEvents:        SignalEvent[]
  tier2StartOffsetMs:  number | null
}
```

Existing Recharts timeline continues to bind to `sessionData`. Sub-project B's new components bind to `signalEvents` (via the projection defined in §10.4) and use `tier2StartOffsetMs` to render the "no transcript coverage" affordance correctly.

---

## 10. Coexistence Constraints (Locked)

### 10.1 Constraint #1 — Reset Contract

`resetEngine()` is the absolute system reset boundary. After invocation, no state from the previous session may persist anywhere in the engine.

**Race guard:** `resetEngine()` must never run concurrently with an in-progress `endSession()` flush. If a flush is active, `resetEngine()` awaits it before proceeding. This bounds the additional delay to the remaining flush time (~100–500ms maximum), which is imperceptible to the user clicking "Start New Session."

```js
async function resetEngine() {
  // 1. Race guard — await any in-progress flush before resetting
  if (endingRef.current && endingPromiseRef.current) {
    try {
      await endingPromiseRef.current
    } catch (_) {
      // flush may have errored — proceed with reset regardless
    }
  }

  // 2. Stop any lingering intervals (defensive)
  if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null }
  if (audioFlushIntervalRef.current) { clearInterval(audioFlushIntervalRef.current); audioFlushIntervalRef.current = null }

  // 3. Clear all main-thread refs
  signalEventsRef.current      = []
  sessionStartTimeRef.current  = null
  pendingTier2StartRef.current = null
  endingRef.current            = false   // cleared after flush completes or was never started
  endingPromiseRef.current     = null
  flushResolveRef.current      = null
  setTier2StartOffsetMs(null)

  // 4. Reset workers — retain loaded models, drop all session state
  aggregatorWorker.postMessage({ type: 'RESET' })
  tier2Worker.postMessage({ type: 'RESET' })
}
```

`handleNewSession` becomes `async` to propagate the await:

```js
async function handleNewSession() {
  await resetEngine()
  // ... existing state resets unchanged ...
  setPhase('LOBBY')
}
```

Workers handling `RESET`:
- AggregatorWorker: `buffer = []; sequenceNum = 0; consecutiveFreezeCount = 0; lastSilenceStartRaw = null; inferenceInFlight = false; sessionStartTime = null;`
- Tier2Worker: drop PCM buffer; reset chunk counter; clear any in-flight inference promise.

Models stay loaded — `RESET` returns the engine to READY, not IDLE. No model re-load cost on new session.

### 10.2 Constraint #2 — Tier 2 Visibility

`tier2StartOffsetMs` is set to `performance.now() - sessionStartTime` at the moment Tier2Worker actually receives `START_SESSION` (either at session start if ready, or via late-attach). This lets Sub-project B's UI distinguish between two semantically different `null` cases for `linguistic_disfluency`:

| Event window | Meaning |
|---|---|
| `event.timestamp < tier2StartOffsetMs` | No transcript coverage — Tier 2 wasn't online yet |
| `event.timestamp >= tier2StartOffsetMs` AND `linguistic_disfluency === null` | No backfill yet (chunk pending) or no speech in window |

If `tier2StartOffsetMs` is `null` for the entire session, Tier 2 never attached — Sub-project B's UI should hide all linguistic-disfluency-derived elements gracefully.

### 10.3 Constraint #3 — End Session Idempotency

```js
const endingRef         = useRef(false)
const endingPromiseRef  = useRef(null)

async function endSession() {
  if (endingRef.current) return endingPromiseRef.current   // idempotent

  endingRef.current = true
  endingPromiseRef.current = new Promise((resolve) => {
    flushResolveRef.current = resolve
    // Stop intervals, post END_SESSION to Tier 2, await chain (see §8)
  })
  return endingPromiseRef.current
}
```

Subsequent calls return the same promise instance. The flag is cleared only by `resetEngine()` — so a session cannot be flushed twice, only flushed once and then reset.

### 10.4 Constraint #4 — Payload Boundary (UI Projection)

`signalEventsRef.current` holds the full-fidelity stream including `signals.raw` (7 FER probabilities + audio fields) and full `context.text` per event. For a 30-minute session at 2 events/sec, that is ~3,600 events × ~250 bytes = ~900KB.

For UI binding, components in Sub-projects B and C should use the projection defined here:

```typescript
interface SignalEventProjection {
  id:        string
  timestamp: number
  signals: {
    facial_tension:        number
    cadence_gap:           boolean
    speech_rush:           boolean
    physical_freeze:       boolean
    linguistic_disfluency: number | null
  }
  context: {
    topic:      string     // text omitted from UI projection
    chunkStart: number
    chunkEnd:   number
  } | null
}

// Utility — colocated with the schema, importable by Sub-projects B and C
export function projectForUI(event: SignalEvent): SignalEventProjection {
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

Memory after projection: ~3,600 × ~80 bytes = ~290KB. The full stream remains available via `signalEventsRef` for research export and Sub-project C's word-level alignment work.

---

## 11. Constants Summary

| Constant | Value | Purpose |
|---|---|---|
| `TICK_INTERVAL_MS` | 500 | FRAME_DATA cadence (Aggregator tick rate) |
| `BUFFER_WINDOW_MS` | 10_000 | Max age before SignalEvent finalization |
| `GAP_THRESHOLD_MS` | 1_500 | Silence duration → `cadence_gap = true` |
| `RUSH_RMS_THRESHOLD` | 0.65 | RMS spike after gap → `speech_rush = true` |
| `FREEZE_TENSION_MIN` | 0.50 | Min `facial_tension` for freeze condition |
| `FREEZE_SILENCE_FLOOR` | 0.05 | Max audio RMS for freeze condition |
| `FREEZE_MIN_TICKS` | 2 | Consecutive ticks required for `physical_freeze` |
| `AUDIO_CHUNK_MS` | 4_000 | PCM accumulation window for Whisper |
| `DRIFT_CLAMP_MS` | 500 | Max absolute drift correction per chunk |

---

## 12. Build Order (Suggested)

The implementation plan should preserve the no-regression invariant at every step. Each step ends with a runnable app:

1. **Stub hook.** Add `useEmotionEngine` returning `{ tier1Ready: true, signalEventsRef: { current: [] }, startSession: noop, endSession: async noop, resetEngine: noop, tier2StartOffsetMs: null, tier2Ready: false }`. Wire into App.jsx (Edits 1, 4, 6). Confirm app behaviour identical to today.
2. **AggregatorWorker skeleton.** Create the worker file; handle LOAD_MODELS by replying WORKER_READY immediately (no FER yet). Hook spawns it, surfaces `tier1Ready`. Wire Edits 2 + 5 (Start button gating).
3. **FRAME_DATA pipeline.** Add 500ms interval with frame capture. AggregatorWorker logs frame receipt; no inference yet. Verify ImageBitmap transfer works.
4. **FER inference + derived signals.** Add Xenova/facial-expression-recognition load. Implement tick cycle producing SignalEvents into the buffer. Add Guards G1, G2, G4.
5. **Finalization pass + emission.** Implement age-based finalization. AggregatorWorker emits SIGNAL_EVENT; hook accumulates into `signalEventsRef`. Verify timestamps, monotonicity, finalization timing.
6. **Tier2Worker skeleton + Whisper load.** Reply WORKER_READY on model ready. Add `tier2Ready` and `tier2StartOffsetMs` tracking. Late-attach logic.
7. **AudioWorklet + AUDIO_CHUNK pipeline.** Separate AudioContext, PCM ring buffer, 4s flush interval. Verify PCM data reaches Tier 2.
8. **Whisper inference + TRANSCRIPT_CHUNK.** Tier2Worker produces basic transcript chunks. V1 topic = current question title. Compute `linguistic_disfluency`. Apply drift clamp G5.
9. **Backfill + relay.** Main thread relays TRANSCRIPT_CHUNK to AggregatorWorker. Implement backfill with Guard G3.
10. **END_SESSION flush ordering.** Implement the §8 protocol. Wire Edit 3.
11. **Coexistence constraints.** Implement #1 (resetEngine), #3 (idempotency). Verify #2 (tier2StartOffsetMs) and #4 (projection utility).
12. **Verification pass.** Confirm no-regression contract: stub-substitute the hook, verify identical behaviour. Confirm signalEvents export contains full-fidelity data; UI projection is opt-in.

---

## 13. Open Questions (None for V1)

All design decisions have been locked through the brainstorming process. Remaining unknowns are implementation-level and resolved during planning:

- Exact API surface of `@xenova/transformers` for the chosen models (resolved during Step 4 / Step 6 of the build order)
- AudioWorklet processor sample-rate handling for Whisper input requirements (resolved during Step 7)
- Browser-specific behaviour of `createImageBitmap` from a canvas under low-frame-rate conditions (resolved during Step 3)

---

## 14. References

- Existing CogniFlow source: `src/App.jsx`, `src/questions.js`
- Existing design documents: `DESIGN.md`, `SPEC.md`, `FAILPROOF.md`
- Companion sub-projects (not yet specified):
  - Sub-project C — Contextual Transcription & Alignment
  - Sub-project B — Behavioral Transparency UI

---

*End of Sub-project A specification.*
