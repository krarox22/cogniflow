import { clamp } from './signals.js'

const DEFAULT_EMOTIONS = { smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }

/**
 * Frame-rate independent stress score (0-100) using a target-tracking model.
 *
 * Each frame we compute a target stress level implied by the current state
 * (emotions + audio), then drift toward it with an exponential moving average.
 * Asymmetric time constants make the score rise faster than it falls — once a
 * spike subsides, the score genuinely recovers instead of ratcheting up.
 */
export function computeStressScore(prev, {
  emotions = DEFAULT_EMOTIONS,
  audioLevel = 0,
  audioThreshold = 12,
  speakingMargin = 3,
  dtMs = 0,
  riseTauMs = 2000,
  fallTauMs = 1600,
  maxDtMs = 100,
}) {
  const dt = Math.min(Math.max(dtMs, 0), maxDtMs)
  const e = { ...DEFAULT_EMOTIONS, ...emotions }
  const isSpeaking = audioLevel > audioThreshold + speakingMargin

  const tension =
    e.fear * 60 +
    e.facial_tension * 50 +
    e.anger * 40 +
    e.contempt * 20
  const speakingBaseline = isSpeaking ? 15 : 0
  const smileSuppression = e.smile * 50

  const target = clamp(tension + speakingBaseline - smileSuppression, 0, 100)

  const tau = target > prev ? riseTauMs : fallTauMs
  const alpha = 1 - Math.exp(-dt / tau)

  return clamp(prev + (target - prev) * alpha, 0, 100)
}

export function smoothStress(prev, raw, alpha = 0.25) {
  const a = clamp(alpha, 0, 1)
  return clamp(prev + (raw - prev) * a, 0, 100)
}
