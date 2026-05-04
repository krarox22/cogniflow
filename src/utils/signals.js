const FILLER_WORDS = ['um', 'uh', 'like', 'basically', 'umm', 'ummm', 'uhh', 'ah', 'ahh', 'so', 'well']
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
 * @param {{ lastSilenceStartRaw: number|null, lastSpeechStartRaw: number|null, silenceBeforeSpeech: number }} state
 * @returns {{ cadence_gap: boolean, speech_rush: boolean, acoustic_disfluency: boolean, nextState: object }}
 */
export function updateCadenceState(audio, rawTimestamp, state) {
  const nextState = { 
    lastSilenceStartRaw: state.lastSilenceStartRaw,
    lastSpeechStartRaw: state.lastSpeechStartRaw ?? null,
    silenceBeforeSpeech: state.silenceBeforeSpeech ?? 0
  }
  let cadence_gap, speech_rush
  let acoustic_disfluency = false

  if (!audio.isSpeaking) {
    if (nextState.lastSilenceStartRaw === null) nextState.lastSilenceStartRaw = rawTimestamp
    cadence_gap = (rawTimestamp - nextState.lastSilenceStartRaw) > GAP_THRESHOLD_MS
    speech_rush = false

    if (nextState.lastSpeechStartRaw !== null) {
      const speechDuration = rawTimestamp - nextState.lastSpeechStartRaw
      if (speechDuration < 1000 && nextState.silenceBeforeSpeech > 500) {
        acoustic_disfluency = true
      }
      nextState.lastSpeechStartRaw = null
    }
  } else {
    if (nextState.lastSpeechStartRaw === null) {
      nextState.lastSpeechStartRaw = rawTimestamp
      if (nextState.lastSilenceStartRaw !== null) {
        nextState.silenceBeforeSpeech = rawTimestamp - nextState.lastSilenceStartRaw
      } else {
        nextState.silenceBeforeSpeech = 0
      }
    }

    // Read wasGapped BEFORE resetting state — ordering is load-bearing
    const wasGapped =
      nextState.lastSilenceStartRaw !== null &&
      (rawTimestamp - nextState.lastSilenceStartRaw) > GAP_THRESHOLD_MS
    cadence_gap = false
    speech_rush = wasGapped && audio.rms > RUSH_RMS_THRESHOLD
    nextState.lastSilenceStartRaw = null
  }

  return { cadence_gap, speech_rush, acoustic_disfluency, nextState }
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
