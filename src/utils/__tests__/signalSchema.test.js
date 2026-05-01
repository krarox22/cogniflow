import { describe, it, expect } from 'vitest'
import { projectForUI } from '../signalSchema.js'

const FULL_EVENT = {
  id: 'sig-1',
  timestamp: 3200,
  finalized: true,
  signals: {
    facial_tension: 0.7,
    cadence_gap: true,
    speech_rush: false,
    physical_freeze: false,
    linguistic_disfluency: 0.3,
    raw: {
      fer: { neutral: 0.1, happy: 0, sad: 0, angry: 0.2, fearful: 0.6, disgusted: 0.1, surprised: 0 },
      audio: { rms: 0.02, isSpeaking: false },
    },
  },
  context: {
    text: 'um so like the algorithm is basically',
    topic: 'Two Sum',
    chunkStart: 2000,
    chunkEnd: 6000,
  },
}

describe('projectForUI', () => {
  it('includes all five derived signals', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.signals.facial_tension).toBe(0.7)
    expect(p.signals.cadence_gap).toBe(true)
    expect(p.signals.speech_rush).toBe(false)
    expect(p.signals.physical_freeze).toBe(false)
    expect(p.signals.linguistic_disfluency).toBe(0.3)
  })

  it('strips the raw layer', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.signals.raw).toBeUndefined()
  })

  it('includes id and timestamp', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.id).toBe('sig-1')
    expect(p.timestamp).toBe(3200)
  })

  it('strips context.text but keeps topic and timestamps', () => {
    const p = projectForUI(FULL_EVENT)
    expect(p.context.text).toBeUndefined()
    expect(p.context.topic).toBe('Two Sum')
    expect(p.context.chunkStart).toBe(2000)
    expect(p.context.chunkEnd).toBe(6000)
  })

  it('preserves null context', () => {
    const noContext = { ...FULL_EVENT, context: null }
    expect(projectForUI(noContext).context).toBeNull()
  })
})
