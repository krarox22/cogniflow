// AudioWorklet processor — runs on the audio rendering thread.
// Accumulates mono Float32 PCM and flushes to main thread every FLUSH_FRAMES frames.
// Import not supported in AudioWorklet scope — keep this file self-contained.

const FLUSH_DURATION_S = 4

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = []
    this._flushFrames = Math.round(FLUSH_DURATION_S * sampleRate)  // sampleRate is a global in AudioWorklet
    this._frameCount = 0
    this.port.onmessage = () => {}   // unused; flush is time-driven
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    // Take channel 0 only (mono)
    const channelData = input[0]
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i])
    }
    this._frameCount += channelData.length

    if (this._frameCount >= this._flushFrames) {
      const pcm = new Float32Array(this._buffer)
      this.port.postMessage({ type: 'PCM_FLUSH', pcm, sampleRate }, [pcm.buffer])
      this._buffer = []
      this._frameCount = 0
    }

    return true   // keep processor alive
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
