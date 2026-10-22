/** Pure audio helpers (no DOM). */

export const TARGET_RATE = 16000;

/**
 * Streaming box-filter resampler to 16 kHz: each output sample is the mean of the input samples in its window,
 * which doubles as a cheap anti-alias filter for speech. Keeps state across calls so chunk boundaries are seamless.
 */
export class StreamingResampler {
  private readonly ratio: number;
  private consumed = 0;
  private emitted = 0;
  private sum = 0;
  private count = 0;

  constructor(
    readonly inputRate: number,
    readonly outputRate = TARGET_RATE,
  ) {
    if (inputRate < outputRate) throw new Error("Upsampling is not supported");
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    const out = new Float32Array(Math.ceil((input.length + this.count) / this.ratio) + 1);
    let n = 0;
    let boundary = (this.emitted + 1) * this.ratio;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]!;
      this.count++;
      this.consumed++;
      if (this.consumed >= boundary) {
        out[n++] = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        this.emitted++;
        boundary = (this.emitted + 1) * this.ratio;
      }
    }
    return out.subarray(0, n).slice();
  }
}

/** Float32 [-1, 1] → 16-bit signed little-endian PCM (Deepgram LINEAR16). */
export function floatToLinear16(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Re-chunk a stream into fixed-size blocks (e.g. 100 ms for captions, 200 ms for the speaker service). */
export class Chunker {
  private buffer = new Float32Array(0);

  constructor(readonly size: number) {}

  push(samples: Float32Array): Float32Array[] {
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    const chunks: Float32Array[] = [];
    let offset = 0;
    while (merged.length - offset >= this.size) {
      chunks.push(merged.slice(offset, offset + this.size));
      offset += this.size;
    }
    this.buffer = merged.slice(offset);
    return chunks;
  }

  flush(): Float32Array | null {
    if (!this.buffer.length) return null;
    const rest = this.buffer;
    this.buffer = new Float32Array(0);
    return rest;
  }
}
