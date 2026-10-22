/**
 * CaptionEngine — OWNER: Ashwath. The core of the product: context-locked caption correction,
 * spoken formula → LaTeX, and gloss → natural sentence.
 *
 * Implementations receive a KnowledgeEngine (Tushar) by constructor injection and may call
 * `getGlossary` / `retrieveContext` for grounding. MOCK_CAPTIONS=true swaps in the fixture-backed mock.
 *
 * Rules:
 *  - Low confidence is not an error: return the input unchanged with confidence < 0.5.
 *  - Throw only on real failures; the live pipeline keeps the raw FINAL caption on screen.
 *  - `text` must equal the concatenation of `parts` (formulas as their LaTeX).
 */
import { z } from "zod";

import { CaptionCorrection, CaptionPart, CaptionSegment, RawTranscriptSegment } from "../domain/captions";
import { Confidence, SessionId } from "../domain/common";
import { SlidePointer } from "../domain/context";
import { SignSource, SignToken } from "../domain/sign";

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

// --- slide pointer (P1) — Ashwath ---------------------------------------------

export const LocateSlideInput = z.object({
  sessionId: SessionId,
  text: z.string(),
  currentSlideIndex: z.number().int().nonnegative().nullable(),
});
export type LocateSlideInput = z.infer<typeof LocateSlideInput>;

/** Which slide/bullet the teacher is on, from the refined caption text + the deck's extracted text. */
export interface SlideLocator {
  readonly name: string;
  /** Null when unsure or there is no READY deck. Must be fast (< 50 ms): runs on every refined segment. */
  locate(input: LocateSlideInput): Promise<SlidePointer | null>;
}

export interface CaptionEngine {
  /** "mock" or "mastra" — surfaced in logs. */
  readonly name: string;

  /** Fix jargon, render spoken formulas. Called once per FINAL segment; must answer in < 1.5 s p95. */
  refineCaption(input: RefineCaptionInput): Promise<RefineCaptionResult>;

  /** Gloss tokens → one natural English sentence. < 2 s. */
  composeSignSentence(input: ComposeSentenceInput): Promise<ComposeSentenceResult>;
}
