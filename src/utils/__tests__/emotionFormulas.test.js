import { describe, it, expect } from 'vitest'
import { computeEmotions, smoothEmotions } from '../emotionFormulas.js'

function bs(overrides = {}) {
  const keys = [
    'mouthSmileLeft', 'mouthSmileRight',
    'browInnerUp',
    'eyeWideLeft', 'eyeWideRight',
    'mouthStretchLeft', 'mouthStretchRight',
    'browDownLeft', 'browDownRight',
    'noseSneerLeft', 'noseSneerRight',
    'eyeSquintLeft', 'eyeSquintRight',
    'mouthFrownLeft', 'mouthFrownRight',
  ]
  const out = {}
  for (const k of keys) out[k] = 0
  return { ...out, ...overrides }
}

describe('computeEmotions', () => {
  it('returns all-zero emotions for a relaxed face', () => {
    const e = computeEmotions(bs())
    expect(e.smile).toBe(0)
    expect(e.fear).toBe(0)
    expect(e.anger).toBe(0)
    expect(e.contempt).toBe(0)
    expect(e.facial_tension).toBe(0)
  })

  it('averages bilateral smile (left+right)/2', () => {
    expect(computeEmotions(bs({ mouthSmileLeft: 1, mouthSmileRight: 1 })).smile).toBe(1)
    expect(computeEmotions(bs({ mouthSmileLeft: 1, mouthSmileRight: 0 })).smile).toBe(0.5)
  })

  it('saturates fear at 1.0 only when ALL fear features are at max', () => {
    const fearMax = bs({
      browInnerUp: 1,
      eyeWideLeft: 1, eyeWideRight: 1,
      mouthStretchLeft: 1, mouthStretchRight: 1,
    })
    expect(computeEmotions(fearMax).fear).toBeCloseTo(1.0, 5)
  })

  it('does NOT saturate anger from a strong frown alone (regression: bilateral averaging)', () => {
    const heavyFrownAndSneer = bs({
      browDownLeft: 1, browDownRight: 1,
      noseSneerLeft: 1, noseSneerRight: 1,
    })
    expect(computeEmotions(heavyFrownAndSneer).anger).toBeCloseTo(0.7, 5)
  })

  it('anger reaches 0.85 ceiling when every anger feature is at max', () => {
    const angerMax = bs({
      browDownLeft: 1, browDownRight: 1,
      noseSneerLeft: 1, noseSneerRight: 1,
      eyeSquintLeft: 1, eyeSquintRight: 1,
    })
    expect(computeEmotions(angerMax).anger).toBeCloseTo(0.85, 5)
  })

  it('contempt reaches 0.7 ceiling when every contempt feature is at max', () => {
    const contemptMax = bs({
      mouthFrownLeft: 1, mouthFrownRight: 1,
      browDownLeft: 1, browDownRight: 1,
    })
    expect(computeEmotions(contemptMax).contempt).toBeCloseTo(0.7, 5)
  })

  it('derives facial_tension as fear*0.6 + anger*0.3 + contempt*0.1', () => {
    const fearOnly = bs({
      browInnerUp: 1,
      eyeWideLeft: 1, eyeWideRight: 1,
      mouthStretchLeft: 1, mouthStretchRight: 1,
    })
    expect(computeEmotions(fearOnly).facial_tension).toBeCloseTo(0.6, 5)
  })

  it('clamps every output to [0, 1]', () => {
    const e = computeEmotions(bs({
      browInnerUp: 5, eyeWideLeft: 5, eyeWideRight: 5,
      mouthStretchLeft: 5, mouthStretchRight: 5,
    }))
    expect(e.fear).toBeLessThanOrEqual(1)
    expect(e.fear).toBeGreaterThanOrEqual(0)
  })

  it('handles missing blendshape keys as 0', () => {
    const e = computeEmotions({ mouthSmileLeft: 0.4, mouthSmileRight: 0.6 })
    expect(e.smile).toBeCloseTo(0.5, 5)
    expect(e.fear).toBe(0)
    expect(e.anger).toBe(0)
  })

  it('suppresses mouthStretch contribution to fear when smiling', () => {
    const noSmile = computeEmotions(bs({
      mouthStretchLeft: 1, mouthStretchRight: 1,
    }))
    const fullSmile = computeEmotions(bs({
      mouthSmileLeft: 1, mouthSmileRight: 1,
      mouthStretchLeft: 1, mouthStretchRight: 1,
    }))
    expect(noSmile.fear).toBeCloseTo(0.30, 5)
    expect(fullSmile.fear).toBeCloseTo(0, 5)
  })

  it('suppresses eyeSquint contribution to anger when smiling (Duchenne smile)', () => {
    const noSmile = computeEmotions(bs({
      eyeSquintLeft: 1, eyeSquintRight: 1,
    }))
    const fullSmile = computeEmotions(bs({
      mouthSmileLeft: 1, mouthSmileRight: 1,
      eyeSquintLeft: 1, eyeSquintRight: 1,
    }))
    expect(noSmile.anger).toBeCloseTo(0.15, 5)
    expect(fullSmile.anger).toBeCloseTo(0, 5)
  })
})

describe('smoothEmotions', () => {
  const ZERO = { smile: 0, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }

  it('returns the current values when prev is null (cold start)', () => {
    const current = { smile: 0.3, fear: 0.2, anger: 0.1, contempt: 0.05, facial_tension: 0.15 }
    expect(smoothEmotions(null, current)).toEqual(current)
  })

  it('applies 80/20 weighting: smoothed = 0.8*prev + 0.2*current', () => {
    const prev = { smile: 1, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }
    const current = { smile: 0, fear: 1, anger: 0.5, contempt: 0.5, facial_tension: 0.5 }
    const s = smoothEmotions(prev, current)
    expect(s.smile).toBeCloseTo(0.8, 5)
    expect(s.fear).toBeCloseTo(0.2, 5)
    expect(s.anger).toBeCloseTo(0.1, 5)
    expect(s.contempt).toBeCloseTo(0.1, 5)
    expect(s.facial_tension).toBeCloseTo(0.1, 5)
  })

  it('converges toward current after many ticks', () => {
    let s = ZERO
    const target = { smile: 0.7, fear: 0, anger: 0, contempt: 0, facial_tension: 0 }
    for (let i = 0; i < 100; i++) s = smoothEmotions(s, target)
    expect(s.smile).toBeCloseTo(0.7, 3)
  })
})
