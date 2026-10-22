/**
 * Maps focused-audio chunks (positions on the 16 kHz source timeline) onto AudioContext time.
 *
 * The first chunk of a generation starts `initialDelay` seconds from now. Later chunks keep their source spacing.
 * If a chunk would land in the past (it arrived late), the whole mapping slides forward by the lateness plus
 * `underrunPadding`: we keep every sample and grow the buffer instead of skipping audio. Pure: no Web Audio here.
 */
export type ScheduledChunk = { when: number; generation: number };

export class PlaybackScheduler {
  private generation = -1;
  /** Context time that corresponds to source sample 0 of the current generation. */
  private origin = 0;
  private lastEnd = 0;
  delay: number;

  constructor(
    private readonly options: { initialDelay: number; underrunPadding?: number; sampleRate?: number; minLead?: number },
  ) {
    this.delay = options.initialDelay;
  }

  get currentGeneration() {
    return this.generation;
  }

  /** Returns where to play the chunk, or null if it belongs to an older generation (drop it). */
  schedule(generation: number, startSample: number, sampleCount: number, now: number): ScheduledChunk | null {
    const rate = this.options.sampleRate ?? 16000;
    const minLead = this.options.minLead ?? 0.02;
    if (generation < this.generation) return null;
    if (generation > this.generation) {
      this.generation = generation;
      // Start after anything still playing from the previous target, so switches never overlap.
      const start = Math.max(now + this.delay, this.lastEnd);
      this.origin = start - startSample / rate;
    }
    let when = this.origin + startSample / rate;
    if (when < now + minLead) {
      const late = now + minLead - when + (this.options.underrunPadding ?? 0.1);
      this.origin += late;
      this.delay += late;
      when += late;
    }
    this.lastEnd = Math.max(this.lastEnd, when + sampleCount / rate);
    return { when, generation };
  }
}
