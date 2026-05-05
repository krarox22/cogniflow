/**
 * Strips the raw telemetry layer and context.text from a full SignalEvent.
 * `finalized` is excluded — it is always `true` at the point of UI consumption and is an internal pipeline concept.
 * Use this when binding events to UI components (Sub-projects B and C).
 * Full-fidelity stream remains available via signalEventsRef for research export.
 *
 * @param {SignalEvent} event
 * @returns {SignalEventProjection}
 */
export function projectForUI(event) {
  const s = event.signals
  return {
    id:        event.id,
    timestamp: event.timestamp,
    signals: {
      facial_tension:        s.facial_tension,
      cadence_gap:           s.cadence_gap,
      speech_rush:           s.speech_rush,
      physical_freeze:       s.physical_freeze,
      linguistic_disfluency: s.linguistic_disfluency,
      ...(typeof s.smile    === 'number' && { smile:    s.smile }),
      ...(typeof s.fear     === 'number' && { fear:     s.fear }),
      ...(typeof s.anger    === 'number' && { anger:    s.anger }),
      ...(typeof s.contempt === 'number' && { contempt: s.contempt }),
    },
    context: event.context && {
      topic:      event.context.topic,
      chunkStart: event.context.chunkStart,
      chunkEnd:   event.context.chunkEnd,
    },
  }
}
