# Blendshape Emotion Detection — Design Spec

**Date:** 2026-05-05
**Status:** Approved

## Overview

Replace the Hugging Face FER model (`Xenova/facial_emotions_image_detection`) with MediaPipe blendshape-based emotion computation. The FaceLandmarker already runs on the main thread and already produces 52 blendshape scores as a free byproduct — they were never being read. This change eliminates ~150MB of model download, removes inference latency from image frames, and enables per-frame emotion signals at no additional cost.

Scope: emotion pipeline only. All downstream consumers (`facial_tension`, freeze detection, coaching cards, cadence FSM, sliding-window finalization) are unchanged.

---

## Architecture

### Data flow (before)

```
App.jsx (FaceLandmarker, EAR only)
  → canvas ImageBitmap every 500ms
    → aggregatorWorker (HuggingFace FER inference → facial_tension)
```

### Data flow (after)

```
App.jsx (FaceLandmarker, EAR + blendshapes)
  ├─→ stress index update (main thread, every frame)
  │     emotionDelta computed directly from blendshapes — no round-trip
  └─→ blendshape float map → aggregatorWorker
        formula-based emotion compute → facial_tension + smile/fear/anger/contempt
        stamped onto finalized events
```

No `ImageBitmap` transfer. No model inference in the worker. The worker receives a plain named-float object. The stress index update uses blendshapes directly on the main thread (already available); the worker receives them separately for event stamping and `facial_tension`.

---

## Files Changed

| File | Change |
|---|---|
| `src/App.jsx` | Enable `outputFaceBlendshapes: true` on FaceLandmarker options. Extract blendshape map from each frame result and pass to aggregatorWorker. |
| `src/hooks/useEmotionEngine.js` | Forward blendshape map from FaceLandmarker result instead of capturing `ImageBitmap` from canvas every 500ms. |
| `src/workers/aggregatorWorker.js` | Remove HuggingFace model load and FER inference. Receive blendshape map. Compute 4 emotions + `facial_tension`. Apply per-emotion smoothing. Stamp finalized events with emotion values. |
| `src/utils/signalSchema.js` | Add 4 optional fields to event schema. |
| `src/utils/reportTimeline.js` | Update combined report chart to include emotion lines, audio level line, and event tick row. |

---

## Emotion Formulas

Computed in `aggregatorWorker.js` from the named blendshape map on every incoming message.

```js
const smile    = (bs.mouthSmileLeft + bs.mouthSmileRight) / 2

const fear     = clamp(
  bs.browInnerUp       * 0.40 +
  bs.eyeWideLeft       * 0.15 +
  bs.eyeWideRight      * 0.15 +
  bs.mouthStretchLeft  * 0.15 +
  bs.mouthStretchRight * 0.15,
  0, 1
)

const anger    = clamp(
  (bs.browDownLeft    + bs.browDownRight)   * 0.40 +
  (bs.noseSneerLeft   + bs.noseSneerRight)  * 0.30 +
  (bs.eyeSquintLeft   + bs.eyeSquintRight)  * 0.15,
  0, 1
)

const contempt = clamp(
  (bs.mouthFrownLeft  + bs.mouthFrownRight) * 0.40 +
  (bs.browDownLeft    + bs.browDownRight)   * 0.30,
  0, 1
)

const facial_tension = clamp(fear * 0.6 + anger * 0.3 + contempt * 0.1, 0, 1)
```

### Per-emotion smoothing

Applied after each computation to prevent flicker:

```js
smoothed[e] = 0.8 * prev[e] + 0.2 * current[e]
```

---

## Stress Index Integration

Emotion signals feed the real-time stress index using time-based scaling so the update is frame-rate independent:

```
Stress_{t+1} = clamp(
  Stress_t + discreteEvents + emotionDelta × (Δt / 500),
  0, 100
)

emotionDelta = fear×4 + anger×3 − smile×3
Δt           = milliseconds since last stress update (performance.now() diff)
```

`discreteEvents` (blink +8, audio RMS +3/+5) fire once per event and are unaffected by this scaling.

**Also fix:** the existing silence decay rule (`−4 per frame`) gets the same time-based scaling treatment: `−4 × (Δt / 500)` per update.

This means at 60fps (~16ms frames), sustained fear=0.5 contributes `0.5 × 4 × (16/500) ≈ 0.064` per frame — stress rises ~3.8 points/second, saturating from 0 in ~26 seconds. No new UI is added during the interview; emotions influence the existing breathing border color through the stress index.

---

## Signal Schema

Four new optional fields added to the finalized event object in `signalSchema.js`:

```json
{
  "smile":    "number — [0, 1]",
  "fear":     "number — [0, 1]",
  "anger":    "number — [0, 1]",
  "contempt": "number — [0, 1]"
}
```

Values are the smoothed emotion scores at the moment of event finalization. All existing fields are unchanged.

---

## Report Chart

The post-session report replaces the two separate charts (stress timeline + emotion breakdown) with a single combined `ComposedChart`:

**Continuous lines:**
| Signal | Color | Style |
|---|---|---|
| Stress index | `#d2a630` amber | Solid, 2.5px |
| Facial tension | `#a371f7` purple | Dashed |
| Fear | `#f85149` red | Solid, 1.5px |
| Anger | `#ff7b72` orange-red | Solid, 1.5px |
| Contempt | `#79c0ff` blue | Solid, 1.5px |
| Smile | `#3fb950` green | Solid, 1.5px |
| Audio level (RMS) | `#58a6ff` blue | Dotted |

**Event tick row** (below chart, separated by a dashed line):
| Event type | Color |
|---|---|
| Cadence gap | `#f0e68c` yellow |
| Speech rush | `#ffa657` orange |
| Acoustic disfluency | `#ff85c8` pink |

---

## What Does Not Change

- `facial_tension` value range and semantics (0–1, same formula concept)
- Freeze detection thresholds
- All 8 coaching card trigger conditions
- Cadence FSM and sliding-window finalization
- Live interview UI (no new emotion widgets — emotions surface only through the stress index → breathing border)
- Calibration protocol
- Audio pipeline
- EAR blink detection

---

## Out of Scope

- Hand gesture tracking
- Real-time emotion labels/bars during interview
- Modifications to coaching card copy
- Changes to the Gemini analysis prompt
