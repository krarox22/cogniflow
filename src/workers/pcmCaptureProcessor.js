// AudioWorklet processor — runs on the audio rendering thread.
// Accumulates mono Float32 PCM and flushes to main thread every FLUSH_FRAMES frames.
// Import not supported in AudioWorklet scope — keep this file self-contained.

const FLUSH_DURATION_S = 4

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._flushFrames = Math.round(FLUSH_DURATION_S * sampleRate)
    this._buffer = new Float32Array(this._flushFrames)
    this._writePos = 0
    this.port.onmessage = () => {}
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const channelData = input[0]
    this._buffer.set(channelData, this._writePos)
    this._writePos += channelData.length

    if (this._writePos >= this._flushFrames) {
      const pcm = this._buffer.slice(0, this._writePos)
      this.port.postMessage({ type: 'PCM_FLUSH', pcm, sampleRate }, [pcm.buffer])
      this._writePos = 0
    }

    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
