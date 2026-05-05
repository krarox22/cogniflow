import { describe, expect, it } from 'vitest'
import { computeStressScore, smoothStress } from '../stressIndex.js'

const calm = { smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }

describe('computeStressScore (target-tracking)', () => {
  it('drifts upward when emotions imply higher stress than current', () => {
    const next = computeStressScore(0, {
      emotions: { ...calm, fear: 0.6, facial_tension: 0.4 },
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(next).toBeGreaterThan(0)
  })

  it('drifts upward when speaking above threshold', () => {
    const next = computeStressScore(0, {
      emotions: calm,
      audioLevel: 18,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(next).toBeGreaterThan(0)
  })

  it('drifts DOWN when emotions go calm after a stressful peak (regression: no ratchet)', () => {
    const next = computeStressScore(80, {
      emotions: calm,
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(next).toBeLessThan(80)
  })

  it('drifts DOWN even while speaking, when implied target is below current score', () => {
    // Previously, isSpeaking blocked all decay. The new model relaxes toward
    // the speaking baseline (~15) instead of monotonically climbing.
    const next = computeStressScore(80, {
      emotions: calm,
      audioLevel: 30,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(next).toBeLessThan(80)
  })

  it('treats near-threshold ambient audio as quiet', () => {
    const next = computeStressScore(40, {
      emotions: calm,
      audioLevel: 13,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(next).toBeLessThan(40)
  })

  it('lets a smile pull stress down even from a high baseline', () => {
    const next = computeStressScore(80, {
      emotions: { ...calm, smile: 0.9 },
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(next).toBeLessThan(80)
  })

  it('clamps large elapsed time so tab lag cannot spike the score', () => {
    const fromNormalFrame = computeStressScore(20, {
      emotions: { ...calm, fear: 1, anger: 1, facial_tension: 1 },
      audioLevel: 80,
      audioThreshold: 12,
      dtMs: 100,
    })
    const fromLaggedFrame = computeStressScore(20, {
      emotions: { ...calm, fear: 1, anger: 1, facial_tension: 1 },
      audioLevel: 80,
      audioThreshold: 12,
      dtMs: 2000,
    })
    expect(fromLaggedFrame).toBeCloseTo(fromNormalFrame, 5)
  })

  it('falls faster than it rises (fallTauMs < riseTauMs for quick recovery)', () => {
    // rise: from 20 toward ~90 (gap ≈70), default riseTauMs=2000
    const rising = computeStressScore(20, {
      emotions: { ...calm, fear: 1, facial_tension: 0.6 },
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })
    // fall: from 80 toward ~10 (gap ≈70), default fallTauMs=1500
    const falling = computeStressScore(80, {
      emotions: { ...calm, fear: 1 / 6 },
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })
    const riseDelta = rising - 20
    const fallDelta = 80 - falling
    expect(fallDelta).toBeGreaterThan(riseDelta)
  })

  it('clamps output to [0, 100]', () => {
    const high = computeStressScore(100, {
      emotions: { ...calm, fear: 1, anger: 1, facial_tension: 1 },
      audioLevel: 80,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(high).toBeLessThanOrEqual(100)
    expect(high).toBeGreaterThanOrEqual(0)

    const low = computeStressScore(0, {
      emotions: { ...calm, smile: 1 },
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })
    expect(low).toBeGreaterThanOrEqual(0)
  })
})

describe('smoothStress', () => {
  it('applies EMA smoothing: smoothed = prev + alpha*(raw-prev)', () => {
    expect(smoothStress(20, 60, 0.25)).toBe(30)
  })

  it('clamps alpha and output to the visible 0-100 range', () => {
    expect(smoothStress(90, 200, 2)).toBe(100)
    expect(smoothStress(10, -50, 2)).toBe(0)
  })
})
