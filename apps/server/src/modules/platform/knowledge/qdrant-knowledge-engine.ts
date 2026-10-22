/**
 * OWNER: Tushar — the real KnowledgeEngine (Qdrant + embeddings + Mastra glossary agent).
 * Until done, run with MOCK_KNOWLEDGE=true. Local Qdrant: `bun run infra:up` (http://localhost:6333).
 */
import type {
  ContextChunk,
  GlossaryTerm,
  IngestContextInput,
  IngestContextResult,
  KnowledgeEngine,
  RetrieveContextInput,
} from "@sightline/contracts";

import { notImplemented } from "../../../lib/errors";

const OWNER = "Tushar";

export class QdrantKnowledgeEngine implements KnowledgeEngine {
  readonly name = "qdrant";

  constructor(
    readonly qdrantUrl: string,
    readonly qdrantApiKey: string | undefined,
    readonly embeddingModel: string,
  ) {}

  async ingestContext(_input: IngestContextInput): Promise<IngestContextResult> {
    // TODO(tushar): chunk slides (per slide + per bullet) and free text → embed → upsert into collection
    //   `ctx_<sessionId>` (payload: text, source, slideIndex, bulletIndex). Glossary agent (structured output
    //   GlossaryTerm[] incl. likely STT mis-hearings as `aliases`). Cache glossary in memory/Postgres.
    throw notImplemented("KnowledgeEngine.ingestContext", OWNER);
  }

  async getGlossary(_sessionId: string): Promise<GlossaryTerm[]> {
    // TODO(tushar): return the cached glossary — this is on Ashwath's hot path, no network calls here.
    throw notImplemented("KnowledgeEngine.getGlossary", OWNER);
  }

  async retrieveContext(_input: RetrieveContextInput): Promise<ContextChunk[]> {
    // TODO(tushar): embed query → Qdrant search in `ctx_<sessionId>` → ContextChunk[] (< 300 ms p95).
    throw notImplemented("KnowledgeEngine.retrieveContext", OWNER);
  }

  async dropSession(_sessionId: string): Promise<void> {
    // TODO(tushar): delete collection + cache.
  }
}
