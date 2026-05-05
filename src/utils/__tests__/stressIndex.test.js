import { describe, expect, it } from 'vitest'
import { computeStressScore } from '../stressIndex.js'

const calm = { smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }

describe('computeStressScore', () => {
  it('raises stress from facial tension even while the room is quiet', () => {
    const next = computeStressScore(20, {
      emotions: { ...calm, fear: 0.4, facial_tension: 0.3 },
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })

    expect(next).toBeGreaterThan(20)
  })

  it('raises stress from normal speaking above the calibrated threshold', () => {
    const next = computeStressScore(20, {
      emotions: calm,
      audioLevel: 18,
      audioThreshold: 12,
      dtMs: 100,
    })

    expect(next).toBeGreaterThan(20)
  })

  it('lets a smile soften stress when no tense signals are present', () => {
    const next = computeStressScore(20, {
      emotions: { ...calm, smile: 0.6 },
      audioLevel: 0,
      audioThreshold: 12,
      dtMs: 100,
    })

    expect(next).toBeLessThan(20)
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
})
