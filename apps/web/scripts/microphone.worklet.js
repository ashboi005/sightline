class ViewerMicrophone extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = new Float32Array(4096)
    this.offset = 0
  }
  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true
    for (const value of input) {
      this.samples[this.offset++] = value
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer])
        this.samples = new Float32Array(4096)
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor("viewer-microphone", ViewerMicrophone)
