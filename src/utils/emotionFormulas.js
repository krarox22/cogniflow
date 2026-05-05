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
