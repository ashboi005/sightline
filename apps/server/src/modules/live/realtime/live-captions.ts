/**
 * OWNER: Ashwath. The live caption pipeline:
 *   STT (Deepgram or replay) → caption.interim / caption.final → CaptionEngine.refineCaption
 *   → caption.refined (+ slide.pointer via KnowledgeEngine) — persisted and broadcast.
 */
import type {
  AudioFormat,
  CaptionEngine,
  CaptionSegment,
  KnowledgeEngine,
  RawTranscriptSegment,
  SlideLocator,
  SlidePointer,
} from "@sightline/contracts";

import type { SessionEvents, SessionStore } from "../../../shared/ports";
import type { SpeechToText, SttStream } from "../speech/types";

const REPLAY_FORMAT: AudioFormat = { encoding: "LINEAR16", sampleRate: 16000, channels: 1 };

type LiveState = { stream: SttStream; nextSeq: number; pointer: SlidePointer | null };

export class LiveCaptions {
  private readonly live = new Map<string, LiveState>();

  constructor(
    private readonly deps: {
      store: SessionStore;
      stt: SpeechToText;
      captions: CaptionEngine;
      knowledge: KnowledgeEngine;
      slides: SlideLocator;
      events: SessionEvents;
    },
  ) {}

  get isReplay() {
    return this.deps.stt.isReplay;
  }

  /** Open the STT stream. Replay mode calls this on session start; real mode on `audio.start`. */
  async start(sessionId: string, startedAt: number, format: AudioFormat = REPLAY_FORMAT): Promise<void> {
    if (this.live.has(sessionId)) return;
    const { store, stt, knowledge } = this.deps;

    const existing = await store.listSegments(sessionId);
    const keyterms = (await knowledge.getGlossary(sessionId).catch(() => [])).map((t) => t.term);
    const state: LiveState = {
      nextSeq: existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.seq)) + 1,
      pointer: null,
      stream: { push: () => {}, close: async () => {} },
    };
    this.live.set(sessionId, state);

    try {
      state.stream = this.openStream(stt, sessionId, format, keyterms, startedAt, state);
    } catch (error) {
      this.live.delete(sessionId);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[live] could not open STT for ${sessionId}: ${message}`);
      this.deps.events.publish(sessionId, { type: "error", code: "STT_ERROR", message, ts: Date.now() });
    }
  }

  private openStream(
    stt: SpeechToText,
    sessionId: string,
    format: AudioFormat,
    keyterms: string[],
    startedAt: number,
    state: LiveState,
  ): SttStream {
    return stt.open({
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
        this.deps.events.publish(sessionId, { type: "error", code: "STT_ERROR", message: error.message, ts: Date.now() });
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
    const { store, events, captions, slides } = this.deps;
    const sessionId = raw.sessionId;

    if (!raw.isFinal) {
      events.publish(sessionId, {
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
    events.publish(sessionId, { type: "caption.final", segment: finalSegment, ts: Date.now() });

    try {
      const previous = (await store.listSegments(sessionId)).filter((s) => s.status === "REFINED").slice(-5);
      const refined = await captions.refineCaption({ sessionId, segment: raw, previous });

      const state = this.live.get(sessionId);
      const pointer = await slides
        .locate({ sessionId, text: refined.text, currentSlideIndex: state?.pointer?.slideIndex ?? null })
        .catch(() => null);

      const refinedSegment: CaptionSegment = { ...finalSegment, ...refined, status: "REFINED", slidePointer: pointer };
      await store.upsertSegment(refinedSegment);
      events.publish(sessionId, { type: "caption.refined", segment: refinedSegment, ts: Date.now() });

      if (pointer && state && (pointer.slideIndex !== state.pointer?.slideIndex || pointer.bulletIndex !== state.pointer?.bulletIndex)) {
        state.pointer = pointer;
        events.publish(sessionId, { type: "slide.pointer", pointer, ts: Date.now() });
      }
    } catch (error) {
      // Refinement is best-effort: the FINAL caption is already on screen.
      console.warn(`[live] refine failed for ${raw.id}:`, error instanceof Error ? error.message : error);
    }
  }
}
