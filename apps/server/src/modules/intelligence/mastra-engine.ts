/**
 * OWNER: Ashwath — the real IntelligenceEngine (Mastra + Qdrant).
 *
 * Every method currently throws NOT_IMPLEMENTED. Replace them one by one; until then run with
 * MOCK_INTELLIGENCE=true. Contract + latency budgets: docs/contracts/intelligence-engine.md.
 * Plan per method is in docs/owners/ashwath.md.
 */
import type {
  ComposeSentenceInput,
  ComposeSentenceResult,
  GenerateNotesInput,
  GlossaryTerm,
  IngestContextInput,
  IngestContextResult,
  IntelligenceEngine,
  LectureNotes,
  LocateSlideInput,
  RefineCaptionInput,
  RefineCaptionResult,
  SlidePointer,
} from "@sightline/contracts";

import { notImplemented } from "../../lib/errors";

const OWNER = "Ashwath";

export class MastraIntelligenceEngine implements IntelligenceEngine {
  readonly name = "mastra";

  async ingestContext(_input: IngestContextInput): Promise<IngestContextResult> {
    // TODO(ashwath): chunk slides/text → embed → upsert into Qdrant collection `ctx_<sessionId>`;
    //   glossary-extraction agent (structured output = GlossaryTerm[] incl. likely mis-hearings as aliases).
    throw notImplemented("IntelligenceEngine.ingestContext", OWNER);
  }

  async getGlossary(_sessionId: string): Promise<GlossaryTerm[]> {
    // TODO(ashwath): return cached glossary from the last ingest (in-memory map or Postgres via Tushar).
    throw notImplemented("IntelligenceEngine.getGlossary", OWNER);
  }

  async refineCaption(_input: RefineCaptionInput): Promise<RefineCaptionResult> {
    // TODO(ashwath): fast path — alias replacement from glossary; LLM path — refiner agent with
    //   retrieved context chunks + previous segments, structured output = CaptionPart[] (formulas as LaTeX).
    throw notImplemented("IntelligenceEngine.refineCaption", OWNER);
  }

  async locateSlide(_input: LocateSlideInput): Promise<SlidePointer | null> {
    // TODO(ashwath, P1): embed text → nearest slide/bullet chunk in Qdrant; hysteresis around currentSlideIndex.
    return null;
  }

  async composeSignSentence(_input: ComposeSentenceInput): Promise<ComposeSentenceResult> {
    // TODO(ashwath): gloss → English agent, grounded with recentCaptions so references resolve.
    throw notImplemented("IntelligenceEngine.composeSignSentence", OWNER);
  }

  async generateNotes(_input: GenerateNotesInput): Promise<Omit<LectureNotes, "id" | "generatedAt">> {
    // TODO(ashwath): Mastra workflow — outline from context/slides → section writer per topic over
    //   transcript → formulas/key terms collation → markdown render. Tag board-heavy sections from awayWindows.
    throw notImplemented("IntelligenceEngine.generateNotes", OWNER);
  }

  async dropSession(_sessionId: string): Promise<void> {
    // TODO(ashwath): delete Qdrant collection + caches.
  }
}
