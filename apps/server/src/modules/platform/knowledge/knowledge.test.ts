import { expect, test } from "bun:test";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { z } from "zod";
import { QdrantKnowledgeEngine } from "./qdrant-knowledge-engine";
import { BoundedCache, chunkContext } from "./chunks";

const input = { sessionId: "ses_knowledge", title: "Circuits", subject: null, text: "Current law\n\nVoltage law", slides: [{ index: 0, title: "KCL", text: "Current is conserved", bullets: [{ index: 0, text: "Sum of currents is zero" }] }] };

test("chunks preserve slide/bullet coordinates and valid UUID point IDs", () => {
  const chunks = chunkContext(input);
  expect(chunks).toHaveLength(4);
  expect(chunks.at(-1)?.bulletIndex).toBe(0);
  for (const chunk of chunks) expect(z.uuid().safeParse(chunk.id).success).toBe(true);
  expect(chunkContext({ ...input, text: "x".repeat(8000), slides: [] }).every((chunk) => chunk.text.length <= 2400)).toBe(true);
});

test("bounded cache evicts oldest values", () => {
  const cache = new BoundedCache<number>(2);
  cache.set("one", 1); cache.set("two", 2); cache.get("one"); cache.set("three", 3);
  expect(cache.get("two")).toBeUndefined();
  expect(cache.get("one")).toBe(1);
});

test("knowledge publishes atomically, caches glossary and query vectors, and applies pointer hysteresis", async () => {
  const calls: string[] = [];
  let embeddings = 0;
  const client = {
    getAliases: async () => ({ aliases: [{ alias_name: "ctx_ses_knowledge", collection_name: "old" }] }),
    createCollection: async () => { calls.push("create"); },
    upsert: async () => { calls.push("upsert"); },
    updateCollectionAliases: async () => { calls.push("publish"); },
    deleteCollection: async () => { calls.push("delete"); },
    query: async () => ({ points: [
      { id: "best", score: 0.8, payload: { text: "KVL", source: "SLIDE", slideIndex: 1, bulletIndex: 2 } },
      { id: "current", score: 0.75, payload: { text: "KCL", source: "SLIDE", slideIndex: 0, bulletIndex: 0 } },
    ] }),
  } as unknown as QdrantClient;
  const knowledge = new QdrantKnowledgeEngine({ client, embeddings: { embed: async (texts) => { embeddings++; return texts.map(() => [1, 0, 0]); } }, model: { generate: async (schema) => schema.parse({ topics: ["KCL"], glossary: [{ term: "Kirchhoff", aliases: ["kerchief"], definition: "Circuit laws", category: "PERSON", source: "TEXT" }] }) } });
  await knowledge.ingestContext(input);
  expect(calls).toEqual(["create", "upsert", "publish", "delete"]);
  expect((await knowledge.getGlossary(input.sessionId))[0]?.aliases).toEqual(["kerchief"]);
  expect((await knowledge.locateSlide({ sessionId: input.sessionId, text: "circuit", currentSlideIndex: 0 }))?.slideIndex).toBe(0);
  await knowledge.locateSlide({ sessionId: input.sessionId, text: "circuit", currentSlideIndex: 0 });
  expect(embeddings).toBe(2);
  calls.length = 0;
  await expect(knowledge.ingestContext(input, async () => false)).rejects.toThrow("superseded");
  expect(calls).not.toContain("publish");
  expect(calls.at(-1)).toBe("delete");
});

test("ambiguous alias success never deletes the published collection", async () => {
  let collection = "old";
  const deleted: string[] = [];
  const client = {
    getAliases: async () => ({ aliases: [{ alias_name: "ctx_ses_knowledge", collection_name: collection }] }),
    createCollection: async () => {}, upsert: async () => {},
    updateCollectionAliases: async (request: { actions: { create_alias?: { collection_name: string } }[] }) => {
      collection = request.actions.find((action) => action.create_alias)!.create_alias!.collection_name;
      throw new Error("Connection lost after successful alias switch");
    },
    deleteCollection: async (name: string) => { deleted.push(name); },
  } as unknown as QdrantClient;
  const engine = new QdrantKnowledgeEngine({ client, embeddings: { embed: async (texts) => texts.map(() => [1, 0]) }, model: { generate: async (schema) => schema.parse({ glossary: [], topics: [] }) } });
  await engine.ingestContext(input).catch(() => {});
  expect(deleted).not.toContain(collection);
});
