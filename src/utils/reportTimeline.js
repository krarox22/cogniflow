const MARKER_Y = {
  pauseMarker: 0.08,
  rushMarker: 0.14,
  freezeMarker: 0.20,
  disfluencyMarker: 0.26,
  tenseDisfluencyMarker: 0.32,
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0))
  const m = Math.floor(safeSeconds / 60).toString().padStart(2, '0')
  const s = (safeSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function parseTimeSeconds(time) {
  if (typeof time !== 'string') return 0
  const [minutes = '0', seconds = '0'] = time.split(':')
  return (Number(minutes) || 0) * 60 + (Number(seconds) || 0)
}

function eventSeconds(event) {
  return Number(((Number(event?.timestamp) || 0) / 1000).toFixed(3))
}

function basePoint(seconds) {
  return {
    seconds,
    time: formatTime(seconds),
    stress: null,
    facialTension: null,
    smile: null,
    fear: null,
    anger: null,
    contempt: null,
    audio: null,
    pauseMarker: null,
    rushMarker: null,
    freezeMarker: null,
    disfluencyMarker: null,
    tenseDisfluencyMarker: null,
  }
}

function getPoint(points, seconds) {
  if (!points.has(seconds)) {
    points.set(seconds, basePoint(seconds))
  }
  return points.get(seconds)
}

export function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

export function buildUnifiedTimeline(sessionData = [], signalEvents = []) {
  const points = new Map()

  for (const sample of sessionData) {
    const seconds = parseTimeSeconds(sample.time)
    const point = getPoint(points, seconds)
    point.time = sample.time || formatTime(seconds)
    point.stress = Number.isFinite(sample.stress) ? sample.stress : Number(sample.stress) || 0
  }

  for (const event of signalEvents) {
    const seconds = eventSeconds(event)
    const point = getPoint(points, seconds)
    const signals = event?.signals || {}

    if (typeof signals.facial_tension === 'number') {
      const tension = signals.facial_tension
      point.facialTension = Math.max(point.facialTension ?? 0, tension)
    }
    if (typeof signals.smile    === 'number') point.smile    = signals.smile
    if (typeof signals.fear     === 'number') point.fear     = signals.fear
    if (typeof signals.anger    === 'number') point.anger    = signals.anger
    if (typeof signals.contempt === 'number') point.contempt = signals.contempt
    const rms = signals.raw?.audio?.rms
    if (typeof rms === 'number') point.audio = rms
    if (signals.cadence_gap) point.pauseMarker = MARKER_Y.pauseMarker
    if (signals.speech_rush) point.rushMarker = MARKER_Y.rushMarker
    if (signals.physical_freeze) point.freezeMarker = MARKER_Y.freezeMarker
    if (typeof signals.linguistic_disfluency === 'number' && signals.linguistic_disfluency > 0.4) {
      point.disfluencyMarker = MARKER_Y.disfluencyMarker
      if (typeof signals.facial_tension === 'number' && signals.facial_tension >= 0.25) {
        point.tenseDisfluencyMarker = MARKER_Y.tenseDisfluencyMarker
      }
    }
  }

  return [...points.values()].sort((a, b) => a.seconds - b.seconds)
}

function countWhere(signalEvents, predicate) {
  return signalEvents.reduce((count, event) => count + (predicate(event?.signals || {}) ? 1 : 0), 0)
}

function card({ title, detected, meaning, strategy, practice, youtubeQuery, resourceUrl }) {
  return {
    title,
    detected,
    meaning,
    strategy,
    practice,
    youtubeQuery,
    resourceUrl: resourceUrl || youtubeSearchUrl(youtubeQuery),
  }
}

export function generateCoachingCards(sessionData = [], signalEvents = []) {
  const cadenceGapCount = countWhere(signalEvents, signals => signals.cadence_gap)
  const nervousPauseCount = countWhere(
    signalEvents,
    signals => signals.cadence_gap && signals.facial_tension >= 0.25,
  )
  const freezeCount = countWhere(signalEvents, signals => signals.physical_freeze)
  const rushCount = countWhere(signalEvents, signals => signals.speech_rush)
  const tenseDisfluencyCount = countWhere(
    signalEvents,
    signals => signals.linguistic_disfluency > 0.4 && signals.facial_tension >= 0.25,
  )
  const tensionValues = signalEvents
    .map(event => event?.signals?.facial_tension)
    .filter(value => typeof value === 'number')
  const disfluencyValues = signalEvents
    .map(event => event?.signals?.linguistic_disfluency)
    .filter(value => typeof value === 'number')

  const maxTension = tensionValues.length > 0 ? Math.max(...tensionValues) : 0
  const averageDisfluency = disfluencyValues.length > 0
    ? disfluencyValues.reduce((sum, value) => sum + value, 0) / disfluencyValues.length
    : 0
  const peakStress = sessionData.reduce((peak, sample) => Math.max(peak, Number(sample.stress) || 0), 0)
  const cards = []

  if (cadenceGapCount >= 1) {
    cards.push(card({
      title: 'Pause Recovery',
      detected: `You had ${cadenceGapCount} long ${cadenceGapCount === 1 ? 'pause' : 'pauses'} during this attempt.`,
      meaning: 'Those moments may indicate places where your next thought needed a little more structure before continuing.',
      strategy: 'Use a bridge phrase instead of silence, such as "Let me think through the tradeoff out loud."',
      practice: 'Before your next mock, answer one problem setup while narrating every assumption for two minutes.',
      youtubeQuery: 'coding interview think aloud practice',
      resourceUrl: 'https://youtu.be/rvIxuaBqsZo',
    }))
  }

  if (nervousPauseCount >= 1) {
    cards.push(card({
      title: 'Nervous Pause Recovery',
      detected: `You had ${cadenceGapCount} long ${cadenceGapCount === 1 ? 'pause' : 'pauses'}, and ${nervousPauseCount} overlapped with elevated facial tension.`,
      meaning: 'If those moments felt nervous, they may indicate uncertainty before continuing.',
      strategy: 'Use box breathing, then restart with a bridge phrase: "Let me think through the tradeoff out loud."',
      practice: 'Before your next mock, do 60 seconds of box breathing and say your bridge phrase once out loud.',
      youtubeQuery: 'box breathing before interview',
      resourceUrl: 'https://youtu.be/Z9pQx-oeSo0',
    }))
  }

  if (freezeCount >= 1) {
    cards.push(card({
      title: 'Freeze Reset Strategy',
      detected: `The timeline marked ${freezeCount} freeze ${freezeCount === 1 ? 'moment' : 'moments'}.`,
      meaning: 'This may indicate a moment where the next step was hard to restart cleanly.',
      strategy: 'Use a reset sentence: "Let me restart from the key constraint."',
      practice: 'Take one solved problem and practice restarting your explanation from the constraint after a five-second pause.',
      youtubeQuery: 'how to stop freezing in interviews',
      resourceUrl: 'https://youtu.be/8jCIrwlkk-k',
    }))
  }

  if (rushCount >= 1) {
    cards.push(card({
      title: 'Slow Re-entry After Pauses',
      detected: `You had ${rushCount} rush ${rushCount === 1 ? 'marker' : 'markers'} after speech resumed.`,
      meaning: 'This may indicate that you sped up while trying to recover momentum.',
      strategy: 'Resume at about 70% speed after a pause, then return to normal pace after one sentence.',
      practice: 'Record a 90-second solution explanation and deliberately slow the first sentence after each pause.',
      youtubeQuery: 'how to speak slower under pressure',
      resourceUrl: 'https://youtu.be/0DSaorcHaRM',
    }))
  }

  if (maxTension >= 0.3) {
    cards.push(card({
      title: 'Tension Release Cue',
      detected: `Facial tension peaked around ${Math.round(maxTension * 100)}% while peak stress was ${peakStress}%.`,
      meaning: 'If this felt effortful, it may be a useful cue to release physical tension before continuing.',
      strategy: 'Use a jaw release, shoulder drop, and slow exhale before your next sentence.',
      practice: 'Do five cycles of jaw release plus a slow exhale before starting your next timed problem.',
      youtubeQuery: 'jaw relaxation breathing exercise',
      resourceUrl: 'https://youtu.be/ZS5EdfTU-Y8',
    }))
  }

  if (averageDisfluency >= 0.4) {
    cards.push(card({
      title: 'Clearer Verbal Structure',
      detected: `Average linguistic disfluency was ${Math.round(averageDisfluency * 100)}% across available transcript windows.`,
      meaning: 'This may indicate places where your explanation would benefit from a reusable structure.',
      strategy: 'Use "Approach, Tradeoff, Edge case" to keep your answer organized.',
      practice: 'For one familiar problem, give three 45-second explanations using only Approach, Tradeoff, Edge case.',
      youtubeQuery: 'coding interview communication tips',
      resourceUrl: 'https://www.youtube.com/watch?v=IfX-gdlAMkU',
    }))
  }

  if (tenseDisfluencyCount >= 1) {
    cards.push(card({
      title: 'Tense Disfluency Recovery',
      detected: `You had ${tenseDisfluencyCount} disfluency ${tenseDisfluencyCount === 1 ? 'marker' : 'markers'} overlapping with elevated facial tension.`,
      meaning: 'When "umms" and "ahhs" overlap with physical tension, it often indicates you are struggling to find the right technical wording under pressure.',
      strategy: 'Pause, release facial tension, and state the simplest version of your thought before adding technical complexity.',
      practice: 'Record yourself explaining a complex topic and intentionally pause to relax your face every time you feel stuck, instead of using filler words.',
      youtubeQuery: 'overcoming interview brain freeze and filler words',
      resourceUrl: 'https://www.youtube.com/watch?v=J-KPU-bBtyU',
    }))
  }

  if (cards.length === 0) {
    cards.push(card({
      title: 'Stable Delivery',
      detected: 'There were few or no notable signal events in this attempt.',
      meaning: 'Your delivery looked steady in the available signals, so the next gain may come from deeper technical explanation.',
      strategy: 'Maintain your pacing and focus on explaining constraints, complexity, and edge cases.',
      practice: 'Take one solved problem and add a concise complexity and edge-case explanation at the end.',
      youtubeQuery: 'advanced coding interview explanation practice',
      resourceUrl: 'https://www.youtube.com/watch?v=IfX-gdlAMkU',
    }))
  }

  return cards.slice(0, 5)
}
