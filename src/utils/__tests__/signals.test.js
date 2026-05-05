import { describe, it, expect } from 'vitest'
import { clamp, updateCadenceState, updateFreezeCount, computeDisfluency } from '../signals.js'

describe('clamp', () => {
  it('clamps values above max to max', () => {
    expect(clamp(1.5, 0, 1)).toBe(1)
  })
  it('clamps values below min to min', () => {
    expect(clamp(-0.5, 0, 1)).toBe(0)
  })
  it('passes through values within range unchanged', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})

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

  it('preserves lastSilenceStartRaw when silence continues (does not reset)', () => {
    // First tick: silence begins at t=1000
    const s1 = updateCadenceState({ isSpeaking: false, rms: 0.01 }, 1000, { lastSilenceStartRaw: null })
    expect(s1.nextState.lastSilenceStartRaw).toBe(1000)
    // Second tick: silence continues at t=1200 — start time must not change
    const s2 = updateCadenceState({ isSpeaking: false, rms: 0.01 }, 1200, s1.nextState)
    expect(s2.nextState.lastSilenceStartRaw).toBe(1000)
  })
})

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
    // Longer sentences needed — short disfluent sentences (e.g. 6 tokens with 1 filler) saturate to 1.0, masking differentiation
    const one = computeDisfluency('um the algorithm sorts arrays and returns the result quickly today tomorrow')
    const three = computeDisfluency('um the um algorithm um sorts arrays and returns the result quickly today tomorrow')
    expect(three).toBeGreaterThan(one)
  })

  it('detects hedge phrases', () => {
    // Sentences must be long enough to avoid saturating to 1.0 (rawScore >= tokens/10).
    // Avoid "well" in the clean fixture — it is itself a filler word.
    const hedge = computeDisfluency('i think the algorithm sorts arrays and maybe returns the result quickly today tomorrow')
    const clean = computeDisfluency('the algorithm sorts arrays and returns the result quickly today tomorrow morning')
    expect(hedge).toBeGreaterThan(clean)
  })

  it('clamps output to 0–1', () => {
    const saturated = computeDisfluency('um um um um um um um um um um um um')
    expect(saturated).toBeLessThanOrEqual(1)
    expect(saturated).toBeGreaterThanOrEqual(0)
  })
})
