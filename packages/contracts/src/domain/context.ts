import { z } from "zod";

import { Confidence, GlossaryTermId, SessionId, SlideDeckId, SlideId, Timestamp } from "./common";
import { ProcessingStatus } from "./session";

export const ContextSource = z.enum(["NONE", "TEXT", "SLIDES", "TEXT_AND_SLIDES"]);
export type ContextSource = z.infer<typeof ContextSource>;

export const GlossaryCategory = z.enum(["TERM", "PERSON", "LAW", "SYMBOL", "UNIT", "FORMULA"]);
export type GlossaryCategory = z.infer<typeof GlossaryCategory>;

/** A domain word the captions must always spell correctly. Also fed to Deepgram as a keyterm. */
export const GlossaryTerm = z.object({
  id: GlossaryTermId,
  term: z.string(),
  /** Likely mis-hearings, e.g. "kerchief" for "Kirchhoff". Used by the caption refiner. */
  aliases: z.array(z.string()),
  definition: z.string().nullable(),
  category: GlossaryCategory,
  source: z.enum(["SLIDES", "TEXT", "LLM"]),
});
export type GlossaryTerm = z.infer<typeof GlossaryTerm>;

/** Everything the system knows about the lecture before/while it runs. */
export const ContextState = z.object({
  sessionId: SessionId,
  status: ProcessingStatus,
  source: ContextSource,
  /** Option B free text (subject, topic summary, syllabus bullets). */
  text: z.string().nullable(),
  topics: z.array(z.string()),
  glossary: z.array(GlossaryTerm),
  /** Number of chunks indexed in Qdrant. */
  chunkCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  updatedAt: Timestamp,
});
export type ContextState = z.infer<typeof ContextState>;

export const SetContextTextInput = z.object({
  text: z.string().min(1).max(20_000),
});
export type SetContextTextInput = z.infer<typeof SetContextTextInput>;

export const SlideBullet = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
});
export type SlideBullet = z.infer<typeof SlideBullet>;

export const Slide = z.object({
  id: SlideId,
  /** 0-based page index. */
  index: z.number().int().nonnegative(),
  /** Rendered page image (PNG/SVG) served by the server. */
  imageUrl: z.string(),
  title: z.string().nullable(),
  /** Full extracted text of the page. */
  text: z.string(),
  bullets: z.array(SlideBullet),
});
export type Slide = z.infer<typeof Slide>;

export const SlideDeck = z.object({
  id: SlideDeckId,
  sessionId: SessionId,
  fileName: z.string(),
  status: ProcessingStatus,
  pageCount: z.number().int().nonnegative(),
  slides: z.array(Slide),
  error: z.string().nullable(),
  uploadedAt: Timestamp,
});
export type SlideDeck = z.infer<typeof SlideDeck>;

/** P1 — where in the deck the teacher currently is. */
export const SlidePointer = z.object({
  slideIndex: z.number().int().nonnegative(),
  bulletIndex: z.number().int().nonnegative().nullable(),
  confidence: Confidence,
});
export type SlidePointer = z.infer<typeof SlidePointer>;
