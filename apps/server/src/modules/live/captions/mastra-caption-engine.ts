/**
 * OWNER: Ashwath — the real CaptionEngine (Mastra). Until done, run with MOCK_CAPTIONS=true.
 * Contract + budgets: docs/contracts/backend-modules.md. Plan: docs/owners/ashwath.md.
 */
import type {
  CaptionEngine,
  ComposeSentenceInput,
  ComposeSentenceResult,
  KnowledgeEngine,
  RefineCaptionInput,
  RefineCaptionResult,
} from "@sightline/contracts";

import { notImplemented } from "../../../lib/errors";

export class MastraCaptionEngine implements CaptionEngine {
  readonly name = "mastra";

  constructor(readonly knowledge: KnowledgeEngine) {}

  async refineCaption(_input: RefineCaptionInput): Promise<RefineCaptionResult> {
    // TODO(ashwath):
    //  1. fast path: refineWithGlossary(text, await knowledge.getGlossary(sessionId))
    //  2. LLM path (fast model, structured output = CaptionPart[]): grounded with
    //     knowledge.retrieveContext({ sessionId, query: text, limit: 4 }) + input.previous,
    //     spoken maths → KaTeX-valid LaTeX `formula` parts. Budget < 1.5 s p95.
    throw notImplemented("CaptionEngine.refineCaption", "Ashwath");
  }

  async composeSignSentence(_input: ComposeSentenceInput): Promise<ComposeSentenceResult> {
    // TODO(ashwath): gloss + confidences + recentCaptions → one natural sentence (+ 2 alternatives).
    throw notImplemented("CaptionEngine.composeSignSentence", "Ashwath");
  }
}
