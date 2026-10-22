/**
 * OWNER: Tushar. The live caption pipeline for one server:
 *   STT (Deepgram or replay) → caption.interim / caption.final → IntelligenceEngine.refineCaption
 *   → caption.refined (+ slide.pointer) — persisted and broadcast through the hub.
 */
import type {
  AudioFormat,
  CaptionSegment,
  IntelligenceEngine,
  RawTranscriptSegment,
  SlidePointer,
} from "@sightline/contracts";

import type { SpeechToText, SttStream } from "../speech/types";
import type { SessionStore } from "../store/types";
import type { SessionHub } from "./hub";

const REPLAY_FORMAT: AudioFormat = { encoding: "LINEAR16", sampleRate: 16000, channels: 1 };

type LiveState = { stream: SttStream; nextSeq: number; pointer: SlidePointer | null };

export class LiveCaptions {
  private readonly live = new Map<string, LiveState>();

  constructor(
    private readonly deps: {
      store: SessionStore;
      stt: SpeechToText;
      intelligence: IntelligenceEngine;
      hub: SessionHub;
    },
  ) {}

  get isReplay() {
    return this.deps.stt.isReplay;
  }

  isRunning(sessionId: string) {
    return this.live.has(sessionId);
  }

  /** Open the STT stream. Replay mode calls this on session start; real mode on `audio.start`. */
  async start(sessionId: string, startedAt: number, format: AudioFormat = REPLAY_FORMAT): Promise<void> {
    if (this.live.has(sessionId)) return;
    const { store, stt, intelligence } = this.deps;

    const existing = await store.listSegments(sessionId);
    const keyterms = (await intelligence.getGlossary(sessionId).catch(() => [])).map((t) => t.term);
    const state: LiveState = {
      nextSeq: existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.seq)) + 1,
      pointer: null,
      stream: { push: () => {}, close: async () => {} },
    };
    this.live.set(sessionId, state);

    state.stream = stt.open({
      sessionId,
      format,
      keyterms,
      startedAt,
      nextSeq: () => state.nextSeq++,
      onSegment: (segment) => {
        this.handleSegment(segment).catch((error) => console.error("[live] segment failed", error));
      },
      onError: (error) => {
        console.error(`[live] STT error for ${sessionId}`, error);
        this.deps.hub.publish(sessionId, { type: "error", code: "STT_ERROR", message: error.message, ts: Date.now() });
      },
    });
  }

  pushAudio(sessionId: string, chunk: Uint8Array): void {
    this.live.get(sessionId)?.stream.push(chunk);
  }

  async stop(sessionId: string): Promise<void> {
    const state = this.live.get(sessionId);
    if (!state) return;
    this.live.delete(sessionId);
    await state.stream.close();
  }

  private async handleSegment(raw: RawTranscriptSegment): Promise<void> {
    const { store, hub, intelligence } = this.deps;
    const sessionId = raw.sessionId;

    if (!raw.isFinal) {
      hub.publish(sessionId, {
        type: "caption.interim",
        segmentId: raw.id,
        seq: raw.seq,
        text: raw.text,
        startMs: raw.startMs,
        ts: Date.now(),
      });
      return;
    }

    const finalSegment: CaptionSegment = {
      id: raw.id,
      sessionId,
      seq: raw.seq,
      status: "FINAL",
      startMs: raw.startMs,
      endMs: raw.endMs,
      speaker: raw.speaker,
      rawText: raw.text,
      text: raw.text,
      parts: [{ type: "text", text: raw.text }],
      corrections: [],
      slidePointer: null,
      confidence: raw.confidence,
    };
    await store.upsertSegment(finalSegment);
    hub.publish(sessionId, { type: "caption.final", segment: finalSegment, ts: Date.now() });

    try {
      const previous = (await store.listSegments(sessionId)).filter((s) => s.status === "REFINED").slice(-5);
      const refined = await intelligence.refineCaption({ sessionId, segment: raw, previous });

      const deck = await store.getSlideDeck(sessionId);
      const state = this.live.get(sessionId);
      const pointer =
        deck?.status === "READY"
          ? await intelligence
              .locateSlide({ sessionId, text: refined.text, currentSlideIndex: state?.pointer?.slideIndex ?? null })
              .catch(() => null)
          : null;

      const refinedSegment: CaptionSegment = { ...finalSegment, ...refined, status: "REFINED", slidePointer: pointer };
      await store.upsertSegment(refinedSegment);
      hub.publish(sessionId, { type: "caption.refined", segment: refinedSegment, ts: Date.now() });

      if (pointer && state && (pointer.slideIndex !== state.pointer?.slideIndex || pointer.bulletIndex !== state.pointer?.bulletIndex)) {
        state.pointer = pointer;
        hub.publish(sessionId, { type: "slide.pointer", pointer, ts: Date.now() });
      }
    } catch (error) {
      // Refinement is best-effort: the FINAL caption is already on screen.
      console.warn(`[live] refine failed for ${raw.id}:`, error instanceof Error ? error.message : error);
    }
  }
}
