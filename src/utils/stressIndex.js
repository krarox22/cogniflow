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
  dtMs = 0,
}) {
  const dt = Math.min(Math.max(dtMs, 0), 100)
  const timeScale = dt / 500
  const e = { ...DEFAULT_EMOTIONS, ...emotions }

  const isSpeaking = audioLevel > audioThreshold

  const emotionDelta =
    e.fear * 5 +
    e.anger * 4 +
    e.contempt * 2 +
    e.facial_tension * 5 -
    e.smile * 3

  const audioDelta = isSpeaking ? 2 + (audioLevel / 100) : 0
  const quietRecovery = !isSpeaking && emotionDelta <= 0.25 ? -1.5 : 0

  return clamp(prev + (emotionDelta + audioDelta + quietRecovery) * timeScale, 0, 100)
}
