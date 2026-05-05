import { describe, expect, it } from 'vitest'
import {
  buildUnifiedTimeline,
  generateCoachingCards,
  youtubeSearchUrl,
} from '../reportTimeline.js'

const sessionData = [
  { time: '00:02', stress: 20, blinks: 1, audioLevel: 10 },
  { time: '00:04', stress: 42, blinks: 1, audioLevel: 15 },
  { time: '00:06', stress: 35, blinks: 2, audioLevel: 12 },
]

function eventAt(timestamp, signals) {
  return {
    id: `event-${timestamp}`,
    timestamp,
    signals: {
      facial_tension: 0,
      cadence_gap: false,
      speech_rush: false,
      physical_freeze: false,
      ...signals,
    },
  }
}

describe('youtubeSearchUrl', () => {
  it('encodes the query into a YouTube search URL', () => {
    expect(youtubeSearchUrl('box breathing before interview')).toBe(
      'https://www.youtube.com/results?search_query=box%20breathing%20before%20interview',
    )
  })
})

describe('buildUnifiedTimeline', () => {
  it('combines session stress and signal events into one time-sorted chart dataset', () => {
    const signalEvents = [
      eventAt(3000, { facial_tension: 0.62, cadence_gap: true }),
      eventAt(5000, { facial_tension: 0.3, speech_rush: true, physical_freeze: true }),
      eventAt(6000, { facial_tension: 0.45, linguistic_disfluency: 0.5 }),
    ]

    const timeline = buildUnifiedTimeline(sessionData, signalEvents)

    expect(timeline.map(d => d.seconds)).toEqual([2, 3, 4, 5, 6])
    expect(timeline.find(d => d.seconds === 2)).toMatchObject({
      time: '00:02',
      stress: 20,
    })
    expect(timeline.find(d => d.seconds === 3)).toMatchObject({
      facialTension: 62,
      pauseMarker: 4,
    })
    expect(timeline.find(d => d.seconds === 5)).toMatchObject({
      rushMarker: 7,
      freezeMarker: 10,
    })
    expect(timeline.find(d => d.seconds === 6)).toMatchObject({
      stress: 35,
      facialTension: 45,
      disfluencyMarker: 13,
    })
  })

  it('does not add disfluency markers at or below the 0.4 threshold', () => {
    const timeline = buildUnifiedTimeline(sessionData, [
      eventAt(3000, { facial_tension: 0.4, linguistic_disfluency: 0.4 }),
    ])

    expect(timeline.find(d => d.seconds === 3).disfluencyMarker).toBeNull()
  })

  it('populates smile/fear/anger/contempt/audio per matched second', () => {
    const timeline = buildUnifiedTimeline(
      [
        { time: '00:02', stress: 25 },
        { time: '00:04', stress: 30 },
      ],
      [{
        id: 'sig-1',
        timestamp: 2000,
        signals: {
          facial_tension: 0.4,
          cadence_gap: false,
          speech_rush: false,
          physical_freeze: false,
          linguistic_disfluency: null,
          smile: 0.1,
          fear: 0.5,
          anger: 0.2,
          contempt: 0.05,
          raw: { audio: { rms: 0.32, isSpeaking: true } },
        },
      }],
    )
    const at2s = timeline.find(p => p.seconds === 2)
    expect(at2s.smile).toBeCloseTo(10, 5)
    expect(at2s.fear).toBeCloseTo(50, 5)
    expect(at2s.anger).toBeCloseTo(20, 5)
    expect(at2s.contempt).toBeCloseTo(5, 5)
    expect(at2s.audio).toBeCloseTo(32, 5)
  })

  it('keeps emotion/audio fields null when no event covers that second', () => {
    const timeline = buildUnifiedTimeline([{ time: '00:00', stress: 10 }], [])
    expect(timeline[0].smile).toBeNull()
    expect(timeline[0].fear).toBeNull()
    expect(timeline[0].audio).toBeNull()
  })
})

describe('generateCoachingCards', () => {
  it('creates Pause Recovery when there are at least three cadence gaps', () => {
    const cards = generateCoachingCards(sessionData, [
      eventAt(1000, { cadence_gap: true }),
      eventAt(2000, { cadence_gap: true }),
      eventAt(3000, { cadence_gap: true }),
    ])

    const pauseRecovery = cards.find(card => card.title === 'Pause Recovery')
    expect(pauseRecovery).toBeDefined()
    expect(pauseRecovery.youtubeQuery).toBe('coding interview think aloud practice')
    expect(pauseRecovery.resourceUrl).toMatch(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//)
  })

  it('creates Nervous Pause Recovery when a cadence gap overlaps elevated facial tension', () => {
    const cards = generateCoachingCards(sessionData, [
      eventAt(1000, { cadence_gap: true, facial_tension: 0.6 }),
    ])

    const card = cards.find(c => c.title === 'Nervous Pause Recovery')
    expect(card.detected).toContain('overlapped with elevated facial tension')
    expect(card.strategy).toContain('bridge phrase')
  })

  it('creates cards for freeze, rush, peak tension, and disfluency patterns', () => {
    const cards = generateCoachingCards(sessionData, [
      eventAt(1000, { physical_freeze: true, facial_tension: 0.8, linguistic_disfluency: 0.5 }),
      eventAt(2000, { speech_rush: true, linguistic_disfluency: 0.3 }),
      eventAt(3000, { speech_rush: true, linguistic_disfluency: 0.4 }),
    ])

    // The first event also satisfies the Tense Disfluency Recovery trigger
    // (linguistic_disfluency > 0.4 + facial_tension >= 0.25), so it's included.
    expect(cards.map(card => card.title)).toEqual([
      'Freeze Reset Strategy',
      'Slow Re-entry After Pauses',
      'Tension Release Cue',
      'Clearer Verbal Structure',
      'Tense Disfluency Recovery',
    ])
  })

  it('creates Stable Delivery when there are few or no signal events', () => {
    const cards = generateCoachingCards(sessionData, [])

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: 'Stable Delivery',
      youtubeQuery: 'advanced coding interview explanation practice',
    })
  })

  it('limits coaching to five cards', () => {
    const cards = generateCoachingCards(sessionData, [
      eventAt(1000, { cadence_gap: true, facial_tension: 0.8, physical_freeze: true, linguistic_disfluency: 0.5 }),
      eventAt(2000, { cadence_gap: true, speech_rush: true, linguistic_disfluency: 0.5 }),
      eventAt(3000, { cadence_gap: true, speech_rush: true, linguistic_disfluency: 0.5 }),
    ])

    expect(cards).toHaveLength(5)
  })
})
