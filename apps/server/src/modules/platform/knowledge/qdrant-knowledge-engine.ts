import { createHash, randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { type GlossaryTerm, IngestContextResult, type ContextChunk, type ContextState, type IngestContextInput, type KnowledgeEngine, type RetrieveContextInput } from "@sightline/contracts";
import { AppError } from "../../../lib/errors";
import type { Embeddings, StructuredModel } from "../ai/structured-model";
import { BoundedCache, chunkContext, type KnowledgeChunk } from "./chunks";
import { deterministicGlossary, GLOSSARY_INSTRUCTIONS, GlossaryDraft, glossaryInput, normalizeGlossary } from "./glossary";

type SearchHit = { id: string | number; score: number; payload?: Record<string, unknown> | null };
type KnowledgeOptions = { client: QdrantClient; embeddings: Embeddings; model: StructuredModel; dimensions?: number; collection?: string; glossaryTimeoutMs?: number };

/** One shared collection; `sessionId` is a tenant-indexed payload key, `version` tags each ingest of a session. */
export const CONTEXT_COLLECTION = "sightline_context";
const isNotFound = (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 404;

export class QdrantKnowledgeEngine implements KnowledgeEngine {
  readonly name = "qdrant";
  private readonly glossary = new Map<string, GlossaryTerm[]>();
  private readonly vectors = new BoundedCache<number[]>();
  private readonly results = new BoundedCache<SearchHit[]>(512, 30_000);
  private readonly chunkCounts = new Map<string, number>();
  /** Published ingest version per session (unknown after a restart → search by session only). */
  private readonly versions = new Map<string, string>();
  private ready: Promise<void> | null = null;
  constructor(private readonly options: KnowledgeOptions) {}

  private get collection() { return this.options.collection ?? CONTEXT_COLLECTION; }

  hydrate(contexts: ContextState[]) {
    for (const context of contexts) {
      this.glossary.set(context.sessionId, context.glossary);
      this.chunkCounts.set(context.sessionId, context.chunkCount);
    }
  }

  /** Creates the shared collection + payload indexes once (idempotent across instances), and checks its dimension. */
  private ensureCollection(dimension: number) {
    this.ready ??= (async () => {
      const { client } = this.options;
      if (!(await client.collectionExists(this.collection)).exists) {
        await client.createCollection(this.collection, { vectors: { size: dimension, distance: "Cosine" } }).catch(async (error) => {
          if (!(await client.collectionExists(this.collection)).exists) throw error; // lost a creation race: fine
        });
        await client.createPayloadIndex(this.collection, { field_name: "sessionId", field_schema: { type: "keyword", is_tenant: true }, wait: true });
        await client.createPayloadIndex(this.collection, { field_name: "version", field_schema: "keyword", wait: true });
      }
      const size = (await client.getCollection(this.collection)).config?.params?.vectors;
      const actual = typeof size === "object" && size !== null && "size" in size ? Number(size.size) : null;
      if (actual !== null && actual !== dimension) throw new Error(`Qdrant collection ${this.collection} has ${actual}-dim vectors, embeddings are ${dimension}-dim`);
    })().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  /** LLM glossary under its own deadline; on failure the deterministic one, so the context still turns READY. */
  private async draftGlossary(input: IngestContextInput, chunks: KnowledgeChunk[]): Promise<GlossaryDraft> {
    try {
      return await this.options.model.generate(GlossaryDraft, GLOSSARY_INSTRUCTIONS, glossaryInput(input, chunks), { timeoutMs: this.options.glossaryTimeoutMs ?? 20_000 });
    } catch (error) {
      console.warn(`[knowledge] LLM glossary failed for ${input.sessionId}, using the deterministic one:`, error instanceof Error ? error.message : error);
      return deterministicGlossary(input);
    }
  }

  private sessionFilter(sessionId: string, version?: string, exceptVersion?: string) {
    return {
      must: [{ key: "sessionId", match: { value: sessionId } }, ...(version ? [{ key: "version", match: { value: version } }] : [])],
      ...(exceptVersion ? { must_not: [{ key: "version", match: { value: exceptVersion } }] } : {}),
    };
  }

  private async deletePoints(filter: ReturnType<QdrantKnowledgeEngine["sessionFilter"]>) {
    try {
      await this.options.client.delete(this.collection, { wait: true, filter });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async ingestContext(input: IngestContextInput, publish: (work: () => Promise<void>) => Promise<boolean> = async (work) => { await work(); return true; }): Promise<IngestContextResult> {
    const chunks = chunkContext(input);
    const version = randomUUID().replace(/-/g, "");
    let written = false;
    let published = false;
    try {
      // The glossary LLM call is the slow part: run it alongside embedding + upsert instead of after them.
      const [drafted, stored] = await Promise.allSettled([
        chunks.length ? this.draftGlossary(input, chunks) : Promise.resolve<GlossaryDraft>({ terms: [], topics: [] }),
        (async () => {
          if (!chunks.length) return;
          const vectors = await this.options.embeddings.embed(chunks.map((chunk) => chunk.text));
          const dimension = this.options.dimensions ?? vectors[0]?.length ?? 768;
          if (vectors.length !== chunks.length || vectors.some((vector) => vector.length !== dimension || vector.some((value) => !Number.isFinite(value)))) throw new Error("Embedding dimensions do not match the configured index");
          await this.ensureCollection(dimension);
          written = true;
          for (let offset = 0; offset < chunks.length; offset += 64) {
            await this.options.client.upsert(this.collection, { wait: true, points: chunks.slice(offset, offset + 64).map((chunk, index) => ({ id: pointId(chunk.id, version), vector: vectors[offset + index]!, payload: { ...chunk, sessionId: input.sessionId, version } })) });
          }
        })(),
      ]);
      // Settle both first: cleanup in `finally` must not race an upsert that is still writing.
      if (stored.status === "rejected") throw stored.reason;
      if (drafted.status === "rejected") throw drafted.reason;
      const draft = drafted.value;
      const terms = normalizeGlossary(draft, input);
      if (!(await publish(async () => {
        published = true;
        this.versions.set(input.sessionId, version);
        this.glossary.set(input.sessionId, terms);
        this.chunkCounts.set(input.sessionId, chunks.length);
        this.results.clear();
      }))) throw new AppError("CONFLICT", "Context ingestion was superseded");
      // Retrieval already filters on the published version; drop the older ones.
      await this.deletePoints(this.sessionFilter(input.sessionId, undefined, version)).catch((error) => console.warn("[knowledge] old context cleanup deferred", error));
      return IngestContextResult.parse({ glossary: terms, topics: draft.topics ?? [], chunkCount: chunks.length, sttKeyterms: [...new Set(terms.map((term) => term.term))].slice(0, 100) });
    } finally {
      if (written && !published) await this.deletePoints(this.sessionFilter(input.sessionId, version)).catch((error) => console.warn("[knowledge] unpublished context cleanup deferred", error));
    }
  }

  async getGlossary(sessionId: string) { return this.glossary.get(sessionId) ?? []; }

  private async search(sessionId: string, text: string, limit: number): Promise<SearchHit[]> {
    if (!this.chunkCounts.get(sessionId)) return [];
    const key = JSON.stringify([sessionId, text, limit]);
    const cached = this.results.get(key);
    if (cached) return cached;
    let vector = this.vectors.get(text);
    if (!vector) {
      vector = (await this.options.embeddings.embed([text]))[0];
      if (!vector) throw new Error("Missing query embedding");
      this.vectors.set(text, vector);
    }
    try {
      const result = await this.options.client.query(this.collection, { query: vector, limit, with_payload: true, filter: this.sessionFilter(sessionId, this.versions.get(sessionId)) });
      this.results.set(key, result.points);
      return result.points;
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async retrieveContext(input: RetrieveContextInput): Promise<ContextChunk[]> {
    const hits = await this.search(input.sessionId, input.query, Math.min(20, Math.max(1, input.limit ?? 5)));
    return hits.filter((hit) => typeof hit.payload?.text === "string").map((hit) => ({ id: String(hit.id), text: String(hit.payload!.text), source: hit.payload!.source === "SLIDE" ? "SLIDE" : "TEXT", slideIndex: typeof hit.payload!.slideIndex === "number" ? hit.payload!.slideIndex : null, score: hit.score }));
  }

  async dropSession(sessionId: string) {
    await this.deletePoints(this.sessionFilter(sessionId));
    this.glossary.delete(sessionId);
    this.chunkCounts.delete(sessionId);
    this.versions.delete(sessionId);
    this.results.clear();
  }
}

/** A point id per (chunk, ingest version): re-ingesting identical text must not overwrite the published version. */
function pointId(chunkId: string, version: string) {
  const hash = createHash("sha256").update(`${chunkId}:${version}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
