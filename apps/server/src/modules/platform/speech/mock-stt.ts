/**
 * Replays fixtures/kirchhoff.script.json as if Deepgram were transcribing a live teacher:
 * two interim updates per segment, then the final raw text. Loops forever with `loopGapMs` between loops.
 */
import type { RawTranscriptSegment } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import { newId } from "../../../lib/ids";
import type { SpeechToText, SttStream, SttStreamOptions } from "./types";

const { segments, loopGapMs } = fixtures.lecture.script;
const lastSegment = segments[segments.length - 1]!;
const LOOP_MS = lastSegment.atMs + lastSegment.durationMs + loopGapMs;

export class MockReplayStt implements SpeechToText {
  readonly name = "mock-replay";
  readonly isReplay = true;

  constructor(private readonly speed: number) {}

  open(options: SttStreamOptions): SttStream {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const at = (ms: number, fn: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms / this.speed);
      timers.add(timer);
    };

    const scheduleLoop = (loopOffsetMs: number) => {
      for (const seg of segments) {
        const id = newId("seg");
        const seq = { value: -1 };
        const words = seg.raw.split(" ");
        const emit = (text: string, isFinal: boolean) => {
          if (seq.value < 0) seq.value = options.nextSeq();
          const startMs = Date.now() - options.startedAt;
          const segment: RawTranscriptSegment = {
            id,
            sessionId: options.sessionId,
            seq: seq.value,
            startMs: Math.max(0, startMs - Math.round(seg.durationMs / this.speed)),
            endMs: Math.max(0, startMs),
            text,
            isFinal,
            speaker: seg.speaker,
            confidence: isFinal ? 0.86 : 0.6,
          };
          options.onSegment(segment);
        };
        const base = loopOffsetMs + seg.atMs;
        at(base + seg.durationMs * 0.35, () => emit(words.slice(0, Math.ceil(words.length * 0.35)).join(" "), false));
        at(base + seg.durationMs * 0.7, () => emit(words.slice(0, Math.ceil(words.length * 0.7)).join(" "), false));
        at(base + seg.durationMs, () => emit(seg.raw, true));
      }
      at(loopOffsetMs + LOOP_MS, () => scheduleLoop(0));
    };

    scheduleLoop(0);

    return {
      push: () => {},
      close: async () => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      },
    };
  }
}
