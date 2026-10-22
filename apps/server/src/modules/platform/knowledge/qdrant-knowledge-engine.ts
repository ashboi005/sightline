import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { GlossaryTerm, IngestContextResult, type ContextChunk, type ContextState, type IngestContextInput, type KnowledgeEngine, type RetrieveContextInput } from "@sightline/contracts";
import { z } from "zod";
import { AppError } from "../../../lib/errors";
import type { Embeddings, StructuredModel } from "../ai/structured-model";
import { BoundedCache, chunkContext } from "./chunks";

const GlossaryDraft = z.object({ glossary: z.array(GlossaryTerm.omit({ id: true }).extend({ definition: z.string().nullish(), aliases: z.array(z.string()).nullish() })).max(200), topics: z.array(z.string()).max(50).nullish() });
type SearchHit = { id: string | number; score: number; payload?: Record<string, unknown> | null };
type KnowledgeOptions = { client: QdrantClient; embeddings: Embeddings; model: StructuredModel; dimensions?: number };

export class QdrantKnowledgeEngine implements KnowledgeEngine {
  readonly name = "qdrant";
  private readonly glossary = new Map<string, GlossaryTerm[]>();
  private readonly vectors = new BoundedCache<number[]>();
  private readonly results = new BoundedCache<SearchHit[]>(512, 30_000);
  private readonly chunkCounts = new Map<string, number>();
  constructor(private readonly options: KnowledgeOptions) {}

  hydrate(contexts: ContextState[]) {
    for (const context of contexts) {
      this.glossary.set(context.sessionId, context.glossary);
      this.chunkCounts.set(context.sessionId, context.chunkCount);
    }
  }

  async ingestContext(input: IngestContextInput, publish: (work: () => Promise<void>) => Promise<boolean> = async (work) => { await work(); return true; }): Promise<IngestContextResult> {
    const chunks = chunkContext(input);
    const base = `ctx_${input.sessionId}`;
    const collection = `${base}_${randomUUID().replace(/-/g, "")}`;
    const previous = (await this.options.client.getAliases()).aliases.find((alias) => alias.alias_name === base)?.collection_name;
    let published = false;
    try {
      const vectors = chunks.length ? await this.options.embeddings.embed(chunks.map((chunk) => chunk.text)) : [];
      const dimension = this.options.dimensions ?? vectors[0]?.length ?? 768;
      if (vectors.length !== chunks.length || vectors.some((vector) => vector.length !== dimension || vector.some((value) => !Number.isFinite(value)))) throw new Error("Embedding dimensions do not match the configured index");
      await this.options.client.createCollection(collection, { vectors: { size: dimension, distance: "Cosine" } });
      for (let offset = 0; offset < chunks.length; offset += 64) {
        await this.options.client.upsert(collection, { wait: true, points: chunks.slice(offset, offset + 64).map((chunk, index) => ({ id: chunk.id, vector: vectors[offset + index]!, payload: { ...chunk, sessionId: input.sessionId } })) });
      }
      const draft = chunks.length ? await this.options.model.generate(GlossaryDraft,
        "Extract lecture topics and a glossary from the source excerpts. Include likely speech-recognition mishearings as aliases, accurate short definitions, category, and source. Never invent lecture content. Prefer terms actually present in the excerpts.",
        { title: input.title, subject: input.subject, excerpts: chunks.map((chunk) => ({ text: chunk.text, source: chunk.source })).slice(0, 120) }) : { glossary: [], topics: [] };
      const terms = draft.glossary.map((term, index) => ({ ...term, definition: term.definition ?? null, id: `trm_${index}_${randomUUID().replace(/-/g, "").slice(0, 12)}`, aliases: [...new Set((term.aliases ?? []).filter((alias) => alias.trim() && alias.toLowerCase() !== term.term.toLowerCase()))] }));
      if (!(await publish(async () => {
        try {
          await this.options.client.updateCollectionAliases({ actions: [...(previous ? [{ delete_alias: { alias_name: base } }] : []), { create_alias: { collection_name: collection, alias_name: base } }] });
        } catch (error) {
          const aliases = await this.options.client.getAliases().catch(() => null);
          if (!aliases?.aliases.some((alias) => alias.alias_name === base && alias.collection_name === collection)) throw error;
        }
        published = true;
        this.glossary.set(input.sessionId, terms);
        this.chunkCounts.set(input.sessionId, chunks.length);
        this.results.clear();
      }))) throw new AppError("CONFLICT", "Context ingestion was superseded");
      if (previous) await this.options.client.deleteCollection(previous).catch((error) => console.warn("[knowledge] old collection cleanup deferred", error));
      return IngestContextResult.parse({ glossary: terms, topics: draft.topics ?? [], chunkCount: chunks.length, sttKeyterms: [...new Set(terms.map((term) => term.term))].slice(0, 100) });
    } finally {
      if (!published) {
        const aliases = await this.options.client.getAliases().catch(() => null);
        if (aliases && !aliases.aliases.some((alias) => alias.collection_name === collection)) await this.options.client.deleteCollection(collection).catch((error) => console.warn("[knowledge] unpublished collection cleanup deferred", error));
      }
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
      const result = await this.options.client.query(`ctx_${sessionId}`, { query: vector, limit, with_payload: true, filter: { must: [{ key: "sessionId", match: { value: sessionId } }] } });
      this.results.set(key, result.points);
      return result.points;
    } catch (error) {
      if (typeof error === "object" && error !== null && "status" in error && error.status === 404) return [];
      throw error;
    }
  }

  async retrieveContext(input: RetrieveContextInput): Promise<ContextChunk[]> {
    const hits = await this.search(input.sessionId, input.query, Math.min(20, Math.max(1, input.limit ?? 5)));
    return hits.filter((hit) => typeof hit.payload?.text === "string").map((hit) => ({ id: String(hit.id), text: String(hit.payload!.text), source: hit.payload!.source === "SLIDE" ? "SLIDE" : "TEXT", slideIndex: typeof hit.payload!.slideIndex === "number" ? hit.payload!.slideIndex : null, score: hit.score }));
  }

  async dropSession(sessionId: string) {
    const base = `ctx_${sessionId}`;
    const aliases = (await this.options.client.getAliases()).aliases;
    if (aliases.some((alias) => alias.alias_name === base)) await this.options.client.updateCollectionAliases({ actions: [{ delete_alias: { alias_name: base } }] });
    const collections = (await this.options.client.getCollections()).collections.filter((collection) => collection.name === base || (collection.name.startsWith(`${base}_`) && /^[a-f0-9]{32}$/.test(collection.name.slice(base.length + 1))));
    for (const collection of collections) await this.options.client.deleteCollection(collection.name);
    this.glossary.delete(sessionId);
    this.chunkCounts.delete(sessionId);
    this.results.clear();
  }
}
