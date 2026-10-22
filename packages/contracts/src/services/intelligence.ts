/**
 * IntelligenceEngine — the ONLY way Tushar's platform module talks to Ashwath's intelligence module.
 *
 * Runs in-process inside apps/server. `MOCK_INTELLIGENCE=true` swaps in the fixture-backed mock.
 * Every input/output has a zod schema so the dev routes (/api/dev/intelligence/*) can validate them and
 * Ashwath can exercise the engine with curl, without the rest of the backend.
 *
 * Rules:
 *  - Implementations must be stateless per call except for per-session data they store themselves
 *    (Qdrant collections, glossary cache) keyed by sessionId.
 *  - Never throw for "low confidence" — return the input unchanged with confidence < 0.5 instead.
 *  - Throw only for real failures; the caller falls back to raw captions / skips the step.
 */
import { z } from "zod";

import { CaptionCorrection, CaptionPart, CaptionSegment, RawTranscriptSegment } from "../domain/captions";
import { Confidence, SessionId } from "../domain/common";
import { ContextState, GlossaryTerm, Slide, SlidePointer } from "../domain/context";
import { AwayWindow } from "../domain/gaze";
import { LectureNotes } from "../domain/notes";
import { Session } from "../domain/session";
import { SignSource, SignToken } from "../domain/sign";

// --- ingestContext ---------------------------------------------------------

export const IngestContextInput = z.object({
  sessionId: SessionId,
  title: z.string(),
  subject: z.string().nullable(),
  /** Option B text, if any. */
  text: z.string().nullable(),
  /** Extracted slide text (images are not needed here). Empty when there is no deck. */
  slides: z.array(Slide.pick({ index: true, title: true, text: true, bullets: true })),
});
export type IngestContextInput = z.infer<typeof IngestContextInput>;

export const IngestContextResult = z.object({
  glossary: z.array(GlossaryTerm),
  topics: z.array(z.string()),
  chunkCount: z.number().int().nonnegative(),
  /** ≤ 100 short phrases for Deepgram keyterm prompting. */
  sttKeyterms: z.array(z.string()).max(100),
});
export type IngestContextResult = z.infer<typeof IngestContextResult>;

// --- refineCaption ---------------------------------------------------------

export const RefineCaptionInput = z.object({
  sessionId: SessionId,
  segment: RawTranscriptSegment,
  /** Last few refined segments (oldest first) — lets the refiner finish formulas spoken across segments. */
  previous: z.array(CaptionSegment).max(10),
});
export type RefineCaptionInput = z.infer<typeof RefineCaptionInput>;

export const RefineCaptionResult = z.object({
  text: z.string(),
  parts: z.array(CaptionPart),
  corrections: z.array(CaptionCorrection),
  confidence: Confidence,
});
export type RefineCaptionResult = z.infer<typeof RefineCaptionResult>;

// --- locateSlide (P1) ------------------------------------------------------

export const LocateSlideInput = z.object({
  sessionId: SessionId,
  text: z.string(),
  currentSlideIndex: z.number().int().nonnegative().nullable(),
});
export type LocateSlideInput = z.infer<typeof LocateSlideInput>;

// --- composeSignSentence ---------------------------------------------------

export const ComposeSentenceInput = z.object({
  sessionId: SessionId,
  tokens: z.array(SignToken).min(1),
  source: SignSource,
  /** Recent caption text so "REPEAT FORMULA" can become "Could you repeat Kirchhoff's voltage law?". */
  recentCaptions: z.array(z.string()).max(10),
});
export type ComposeSentenceInput = z.infer<typeof ComposeSentenceInput>;

export const ComposeSentenceResult = z.object({
  text: z.string(),
  alternatives: z.array(z.string()),
  confidence: Confidence,
});
export type ComposeSentenceResult = z.infer<typeof ComposeSentenceResult>;

// --- generateNotes ---------------------------------------------------------

export const GenerateNotesInput = z.object({
  session: Session,
  context: ContextState,
  slides: z.array(Slide),
  transcript: z.array(CaptionSegment),
  awayWindows: z.array(AwayWindow),
});
export type GenerateNotesInput = z.infer<typeof GenerateNotesInput>;

// --- the interface ---------------------------------------------------------

export interface IntelligenceEngine {
  /** "mock" or "mastra" — surfaced in logs and /api/health. */
  readonly name: string;

  /** Index slides/text into Qdrant and build the glossary. Idempotent: re-ingest replaces previous data. */
  ingestContext(input: IngestContextInput): Promise<IngestContextResult>;

  /** Glossary built by the last ingest (empty array if none). */
  getGlossary(sessionId: string): Promise<GlossaryTerm[]>;

  /** Fix jargon, render spoken formulas. Called once per FINAL segment; must answer in < 1.5 s p95. */
  refineCaption(input: RefineCaptionInput): Promise<RefineCaptionResult>;

  /** P1 — which slide/bullet the text is about. Null when unsure or there are no slides. */
  locateSlide(input: LocateSlideInput): Promise<SlidePointer | null>;

  /** Gloss tokens → one natural English sentence. */
  composeSignSentence(input: ComposeSentenceInput): Promise<ComposeSentenceResult>;

  /** Build structured notes after the lecture. May take ~30 s; called from a background job. */
  generateNotes(input: GenerateNotesInput): Promise<Omit<LectureNotes, "id" | "generatedAt">>;

  /** Free per-session resources (Qdrant collection, caches). */
  dropSession(sessionId: string): Promise<void>;
}
