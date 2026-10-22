import { z } from "zod";

import { Confidence, GlossaryTermId, OffsetMs, SegmentId, SessionId } from "./common";
import { SlidePointer } from "./context";

/**
 * A caption is a list of parts so the UI can render terms and formulas specially.
 * Render `formula` parts with KaTeX; `display: BLOCK` gets its own line.
 */
export const CaptionPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("term"),
    text: z.string(),
    glossaryTermId: GlossaryTermId.nullable(),
    /** What the STT originally heard, if it was corrected ("kerchief"). */
    original: z.string().nullable(),
  }),
  z.object({
    type: z.literal("formula"),
    latex: z.string(),
    /** The words the teacher actually said. Shown on hover / used as alt text. */
    spoken: z.string(),
    display: z.enum(["INLINE", "BLOCK"]),
  }),
]);
export type CaptionPart = z.infer<typeof CaptionPart>;

/** INTERIM = still being spoken. FINAL = STT is done (raw). REFINED = corrected by the CaptionEngine. */
export const CaptionStatus = z.enum(["INTERIM", "FINAL", "REFINED"]);
export type CaptionStatus = z.infer<typeof CaptionStatus>;

export const CaptionCorrection = z.object({
  from: z.string(),
  to: z.string(),
  reason: z.enum(["GLOSSARY", "FORMULA", "GRAMMAR", "CONTEXT"]),
});
export type CaptionCorrection = z.infer<typeof CaptionCorrection>;

export const CaptionSegment = z.object({
  id: SegmentId,
  sessionId: SessionId,
  /** Monotonic per session. Order captions by this, not by arrival. */
  seq: z.number().int().nonnegative(),
  status: CaptionStatus,
  startMs: OffsetMs,
  endMs: OffsetMs,
  speaker: z.string().nullable(),
  /** Exactly what STT produced. */
  rawText: z.string(),
  /** Plain-text version of the refined caption (formulas as LaTeX inline). */
  text: z.string(),
  parts: z.array(CaptionPart),
  corrections: z.array(CaptionCorrection),
  slidePointer: SlidePointer.nullable(),
  confidence: Confidence,
});
export type CaptionSegment = z.infer<typeof CaptionSegment>;

/** Output of the STT adapter (Deepgram or the mock replay) before refinement. */
export const RawTranscriptSegment = z.object({
  id: SegmentId,
  sessionId: SessionId,
  seq: z.number().int().nonnegative(),
  startMs: OffsetMs,
  endMs: OffsetMs,
  text: z.string(),
  isFinal: z.boolean(),
  speaker: z.string().nullable(),
  confidence: Confidence,
});
export type RawTranscriptSegment = z.infer<typeof RawTranscriptSegment>;
