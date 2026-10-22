/**
 * KnowledgeEngine — OWNER: Tushar. Lecture context RAG (Qdrant) + glossary.
 *
 * Consumers:
 *  - Ashwath's live caption pipeline: `getGlossary` (STT keyterms + fast corrections) and `retrieveContext`
 *    (grounding for the caption refiner / sign composer).
 *  - Tushar's own notes engine.
 *
 * In-process inside apps/server. MOCK_KNOWLEDGE=true swaps in the fixture-backed mock.
 * Rules: never throw for "nothing found" — return [] / null. Throw only on real failures (Qdrant down);
 * callers then continue without context.
 */
import { z } from "zod";

import { SessionId } from "../domain/common";
import { GlossaryTerm, Slide } from "../domain/context";

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

// --- retrieveContext -------------------------------------------------------

export const RetrieveContextInput = z.object({
  sessionId: SessionId,
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
});
export type RetrieveContextInput = z.infer<typeof RetrieveContextInput>;

export const ContextChunk = z.object({
  id: z.string(),
  text: z.string(),
  source: z.enum(["SLIDE", "TEXT"]),
  slideIndex: z.number().int().nonnegative().nullable(),
  score: z.number(),
});
export type ContextChunk = z.infer<typeof ContextChunk>;

export interface KnowledgeEngine {
  /** "mock" or "qdrant" — surfaced in logs. */
  readonly name: string;

  /** Index slides/text into Qdrant and build the glossary. Idempotent: re-ingest replaces previous data. < 20 s. */
  ingestContext(input: IngestContextInput): Promise<IngestContextResult>;

  /** Glossary from the last ingest ([] if none). Hot path — must be cached, < 50 ms. */
  getGlossary(sessionId: string): Promise<GlossaryTerm[]>;

  /** Top-k chunks relevant to `query`. Called per caption segment — < 300 ms p95. */
  retrieveContext(input: RetrieveContextInput): Promise<ContextChunk[]>;

  /** Free per-session resources (Qdrant collection, caches). */
  dropSession(sessionId: string): Promise<void>;
}
