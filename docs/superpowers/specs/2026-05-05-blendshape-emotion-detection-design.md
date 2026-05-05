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
  → useEmotionEngine (or dedicated hook) — main thread, every frame:
      1. compute raw emotions from blendshape map
      2. apply 80/20 smoothing (smoothing state lives in a ref)
      3. derive facial_tension from smoothed values
      4. produce { smile, fear, anger, contempt, facial_tension }
  ├─→ stress index update (main thread, same frame)
  │     uses smoothed emotions directly
  └─→ aggregatorWorker (5 derived floats only, not 52 blendshapes)
        stamps values onto finalized events
```

No `ImageBitmap` transfer. No model inference in the worker. **Single source of truth on the main thread**: emotions are computed and smoothed once per frame, then consumed by both the live stress index and the worker (which only stamps them onto events). This guarantees the live breathing border and the post-session report read identical values.

---

## Files Changed

| File | Change |
|---|---|
| `src/App.jsx` | Enable `outputFaceBlendshapes: true` on FaceLandmarker options. Pass blendshape map to `useEmotionEngine`. Use the resulting smoothed emotions in the stress-index update with clamped Δt. |
| `src/hooks/useEmotionEngine.js` | Compute the 4 emotions from the blendshape map. Apply 80/20 smoothing (state in a ref). Derive `facial_tension`. Forward the 5 smoothed floats to `aggregatorWorker` instead of `ImageBitmap`. This is the **single source of truth** for emotion values. |
| `src/workers/aggregatorWorker.js` | Remove HuggingFace model load and FER inference. Receive 5 pre-computed floats (`smile`, `fear`, `anger`, `contempt`, `facial_tension`). Stamp them onto finalized events. No emotion computation, no smoothing — those happen on the main thread. |
| `src/utils/signalSchema.js` | Add 4 optional fields to event schema. |
| `src/utils/reportTimeline.js` | Update combined report chart to include emotion lines, audio level line, and event tick row. |

---

## Emotion Formulas

Computed on the **main thread** in `useEmotionEngine.js` from the named blendshape map every animation frame. Bilateral pairs are averaged before weighting so the formulas are properly normalized to `[0, 1]` and don't saturate from mild expressions.

```js
const avg = (a, b) => (a + b) / 2

const smile    = avg(bs.mouthSmileLeft, bs.mouthSmileRight)

const fear     = clamp(
  bs.browInnerUp                                       * 0.40 +
  avg(bs.eyeWideLeft,      bs.eyeWideRight)            * 0.30 +
  avg(bs.mouthStretchLeft, bs.mouthStretchRight)       * 0.30,
  0, 1
)

const anger    = clamp(
  avg(bs.browDownLeft,   bs.browDownRight)             * 0.40 +
  avg(bs.noseSneerLeft,  bs.noseSneerRight)            * 0.30 +
  avg(bs.eyeSquintLeft,  bs.eyeSquintRight)            * 0.15,
  0, 1
)

const contempt = clamp(
  avg(bs.mouthFrownLeft, bs.mouthFrownRight)           * 0.40 +
  avg(bs.browDownLeft,   bs.browDownRight)             * 0.30,
  0, 1
)

const facial_tension = clamp(fear * 0.6 + anger * 0.3 + contempt * 0.1, 0, 1)
```

### Per-emotion smoothing

Applied immediately after each raw computation. Smoothing state lives in a `useRef` on the main thread:

```js
smoothed[e] = 0.8 * prev[e] + 0.2 * current[e]
```

The smoothed values are what get used by the stress index, the worker (for event stamping), and the report chart. There is no second smoothing pass anywhere.

---

## Stress Index Integration

Emotion signals feed the real-time stress index using time-based scaling so the update is frame-rate independent. Δt is **clamped at 100ms** to prevent lag-induced spikes from tab throttling, GC pauses, or OS hitches:

```js
const dtRaw     = now - lastStressUpdate     // performance.now() diff
const dt        = Math.min(dtRaw, 100)        // clamp to prevent lag spikes
const timeScale = dt / 500                    // normalize to 500ms tick

const emotionDelta = fear * 4 + anger * 3 - smile * 3
const silenceDecay = isSilent ? -4 : 0       // existing rule, now time-scaled

Stress_{t+1} = clamp(
  Stress_t + discreteEvents + (emotionDelta + silenceDecay) * timeScale,
  0, 100
)
```

`discreteEvents` (blink +8, audio RMS +3/+5) fire once per event and are unaffected by this scaling.

**Also fix:** the existing silence decay rule (`−4 per frame`) gets the same time-based scaling treatment as shown above. Without the Δt clamp, a 2-second tab freeze followed by a tense expression would multiply the emotion delta by 4× and instantly saturate stress to 100 — purely an artifact of browser lag.

At 60fps (~16ms frames) with sustained fear=0.5: `0.5 × 4 × (16/500) ≈ 0.064` per frame — stress rises ~3.8 points/second, saturating from 0 in ~26 seconds. No new UI is added during the interview; emotions influence the existing breathing border color through the stress index.

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

The post-session report replaces the two separate charts (stress timeline + emotion breakdown) with a single combined Recharts `ComposedChart` using a **dual Y-axis** so the 0–100 stress scale and the 0–1 emotion/audio scales stay readable without one crushing the other into a flat line.

**Y-axes:**
| Axis | Side | Range | Used by |
|---|---|---|---|
| `yAxisId="stress"` | left | 0–100 | Stress index |
| `yAxisId="signals"` | right | 0–1 | Facial tension, fear, anger, contempt, smile, audio RMS |

**Continuous lines** (each line declares its `yAxisId`):
| Signal | Y-axis | Color | Style |
|---|---|---|---|
| Stress index | `stress` | `#d2a630` amber | Solid, 2.5px |
| Facial tension | `signals` | `#a371f7` purple | Dashed |
| Fear | `signals` | `#f85149` red | Solid, 1.5px |
| Anger | `signals` | `#ff7b72` orange-red | Solid, 1.5px |
| Contempt | `signals` | `#79c0ff` blue | Solid, 1.5px |
| Smile | `signals` | `#3fb950` green | Solid, 1.5px |
| Audio level (RMS) | `signals` | `#58a6ff` blue | Dotted |

**Event tick row** (below the chart's main plot area, in a dedicated track using a fixed scatter band so the ticks don't collide with the plotted lines):
| Event type | Color |
|---|---|
| Cadence gap | `#f0e68c` yellow |
| Speech rush | `#ffa657` orange |
| Acoustic disfluency | `#ff85c8` pink |

The custom tooltip shows all values at the hovered timestamp with their respective scales labeled.

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
