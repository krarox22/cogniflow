import { clamp } from './signals.js'

const DEFAULT_EMOTIONS = { smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }

/**
 * Frame-rate independent live stress integration.
 * Uses the same 0-100 UI scale as the visible stress score.
 */
export function computeStressScore(prev, {
  emotions = DEFAULT_EMOTIONS,
  audioLevel = 0,
  audioThreshold = 12,
  speakingMargin = 3,
  dtMs = 0,
  quietRecoveryBase = 1.5,
  quietRecoveryScale = 25,
  maxDtMs = 100,
}) {
  const dt = Math.min(Math.max(dtMs, 0), maxDtMs)
  const timeScale = dt / 500
  const e = { ...DEFAULT_EMOTIONS, ...emotions }

  const isSpeaking = audioLevel > audioThreshold + speakingMargin

  const emotionDelta =
    e.fear * 5 +
    e.anger * 4 +
    e.contempt * 2 +
    e.facial_tension * 5 -
    e.smile * 3

  const audioDelta = isSpeaking ? 2 + (audioLevel / 100) : 0
  const quietRecovery = !isSpeaking && emotionDelta <= 0.25
    ? -(quietRecoveryBase + prev / quietRecoveryScale)
    : 0

  return clamp(prev + (emotionDelta + audioDelta + quietRecovery) * timeScale, 0, 100)
}

export function smoothStress(prev, raw, alpha = 0.25) {
  const a = clamp(alpha, 0, 1)
  return clamp(prev + (raw - prev) * a, 0, 100)
}
