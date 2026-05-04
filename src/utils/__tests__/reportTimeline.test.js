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
      pauseMarker: 8,
    })
    expect(timeline.find(d => d.seconds === 5)).toMatchObject({
      rushMarker: 14,
      freezeMarker: 20,
    })
    expect(timeline.find(d => d.seconds === 6)).toMatchObject({
      stress: 35,
      facialTension: 45,
      disfluencyMarker: 26,
    })
  })

  it('does not add disfluency markers at or below the 0.4 threshold', () => {
    const timeline = buildUnifiedTimeline(sessionData, [
      eventAt(3000, { facial_tension: 0.4, linguistic_disfluency: 0.4 }),
    ])

    expect(timeline.find(d => d.seconds === 3).disfluencyMarker).toBeNull()
  })
})

describe('generateCoachingCards', () => {
  it('creates Pause Recovery when there are at least three cadence gaps', () => {
    const cards = generateCoachingCards(sessionData, [
      eventAt(1000, { cadence_gap: true }),
      eventAt(2000, { cadence_gap: true }),
      eventAt(3000, { cadence_gap: true }),
    ])

    expect(cards.map(card => card.title)).toContain('Pause Recovery')
    expect(cards.find(card => card.title === 'Pause Recovery').resourceUrl).toContain(
      'coding%20interview%20think%20aloud%20practice',
    )
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

    expect(cards.map(card => card.title)).toEqual([
      'Freeze Reset Strategy',
      'Slow Re-entry After Pauses',
      'Tension Release Cue',
      'Clearer Verbal Structure',
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
