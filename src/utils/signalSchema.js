/**
 * Strips the raw FER/audio layer and context.text from a full SignalEvent.
 * `finalized` is excluded — it is always `true` at the point of UI consumption and is an internal pipeline concept.
 * Use this when binding events to UI components (Sub-projects B and C).
 * Full-fidelity stream remains available via signalEventsRef for research export.
 *
 * @param {SignalEvent} event
 * @returns {SignalEventProjection}
 */
export function projectForUI(event) {
  return {
    id:        event.id,
    timestamp: event.timestamp,
    signals: {
      facial_tension:        event.signals.facial_tension,
      cadence_gap:           event.signals.cadence_gap,
      speech_rush:           event.signals.speech_rush,
      physical_freeze:       event.signals.physical_freeze,
      linguistic_disfluency: event.signals.linguistic_disfluency,
    },
    context: event.context && {
      topic:      event.context.topic,
      chunkStart: event.context.chunkStart,
      chunkEnd:   event.context.chunkEnd,
    },
  }
}
