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

type Filter = { must: { key: string; match: { value: string } }[]; must_not?: { key: string; match: { value: string } }[] };
const describeFilter = (filter: Filter) => [...filter.must.map((c) => `${c.key}=${c.key === "version" ? "v" : c.match.value}`), ...(filter.must_not ?? []).map((c) => `${c.key}!=v`)].join("&");

/** In-memory stand-in for the parts of QdrantClient the engine uses (one shared collection). */
function fakeQdrant(size = 3) {
  const calls: string[] = [];
  const points = new Map<string, { payload: Record<string, unknown> }>();
  let exists = false;
  const matches = (payload: Record<string, unknown>, filter: Filter) =>
    filter.must.every((c) => payload[c.key] === c.match.value) && !(filter.must_not ?? []).some((c) => payload[c.key] === c.match.value);
  const client = {
    collectionExists: async () => ({ exists }),
    createCollection: async (_name: string, config: { vectors: { size: number } }) => { calls.push(`create:${config.vectors.size}`); exists = true; },
    createPayloadIndex: async (_name: string, index: { field_name: string }) => { calls.push(`index:${index.field_name}`); },
    getCollection: async () => ({ config: { params: { vectors: { size } } } }),
    upsert: async (_name: string, request: { points: { id: string; payload: Record<string, unknown> }[] }) => {
      calls.push("upsert");
      for (const point of request.points) points.set(point.id, { payload: point.payload });
    },
    delete: async (_name: string, request: { filter: Filter }) => {
      calls.push(`delete:${describeFilter(request.filter)}`);
      for (const [id, point] of points) if (matches(point.payload, request.filter)) points.delete(id);
    },
    query: async (_name: string, request: { filter: Filter }) => {
      calls.push(`query:${describeFilter(request.filter)}`);
      return { points: [...points.values()].filter((p) => matches(p.payload, request.filter)).map((p, i) => ({ id: `p${i}`, score: 1 - i / 10, payload: p.payload })) };
    },
  };
  return { client: client as unknown as QdrantClient, calls, points };
}

test("knowledge publishes atomically into one shared collection and caches glossary, retrieval and query vectors", async () => {
  const { client, calls, points } = fakeQdrant();
  let embeddings = 0;
  const knowledge = new QdrantKnowledgeEngine({ client, embeddings: { embed: async (texts) => { embeddings++; return texts.map(() => [1, 0, 0]); } }, model: { generate: async (schema) => schema.parse({ topics: ["KCL"], terms: [{ term: "Kirchhoff", aliases: ["kerchief"], definition: "Circuit laws", category: "PERSON" }] }) } });
  await knowledge.ingestContext(input);
  expect(calls).toEqual(["create:3", "index:sessionId", "index:version", "upsert", "delete:sessionId=ses_knowledge&version!=v"]);
  expect(points.size).toBe(4);
  expect((await knowledge.getGlossary(input.sessionId))[0]?.aliases).toEqual(["kerchief"]);
  expect((await knowledge.retrieveContext({ sessionId: input.sessionId, query: "circuit", limit: 5 })).length).toBe(4);
  expect(calls.at(-1)).toBe("query:sessionId=ses_knowledge&version=v"); // only the published version
  await knowledge.retrieveContext({ sessionId: input.sessionId, query: "circuit", limit: 5 });
  expect(embeddings).toBe(2); // ingest + one query vector (second retrieval is cached)

  calls.length = 0;
  await expect(knowledge.ingestContext(input, async () => false)).rejects.toThrow("superseded");
  expect(calls).toEqual(["upsert", "delete:sessionId=ses_knowledge&version=v"]); // only its own version
  expect(points.size).toBe(4); // the published version survives

  await knowledge.ingestContext({ ...input, slides: [] });
  expect(points.size).toBe(2); // re-ingest replaced the old version
  await knowledge.dropSession(input.sessionId);
  expect(points.size).toBe(0);
  expect(await knowledge.retrieveContext({ sessionId: input.sessionId, query: "x", limit: 5 })).toEqual([]);
});

test("re-ingesting identical text never overwrites the published points before publish", async () => {
  const { client, points } = fakeQdrant();
  const engine = new QdrantKnowledgeEngine({ client, embeddings: { embed: async (texts) => texts.map(() => [1, 0, 0]) }, model: { generate: async (schema) => schema.parse({ terms: [], topics: [] }) } });
  await engine.ingestContext(input);
  const published = new Set(points.keys());
  await engine.ingestContext(input, async () => false).catch(() => {});
  expect(new Set(points.keys())).toEqual(published);
});

test("a failed glossary LLM call falls back to the deterministic glossary and still publishes", async () => {
  const { client, points } = fakeQdrant();
  const engine = new QdrantKnowledgeEngine({ client, embeddings: { embed: async (texts) => texts.map(() => [1, 0, 0]) }, model: { generate: async () => { throw new Error("LLM down"); } } });
  const result = await engine.ingestContext({ ...input, text: "Kirchhoff's current law (KCL) and Ohm's law" });
  expect(result.glossary.map((t) => t.term)).toEqual(expect.arrayContaining(["Kirchhoff's current law", "Ohm's law"]));
  expect(points.size).toBeGreaterThan(0);
});

test("a failed upsert never leaves partially written points behind", async () => {
  const { client, points } = fakeQdrant();
  const upsert = client.upsert.bind(client);
  (client as { upsert: unknown }).upsert = async (...args: Parameters<typeof upsert>) => { await upsert(...args); throw new Error("connection reset"); };
  const engine = new QdrantKnowledgeEngine({ client, embeddings: { embed: async (texts) => texts.map(() => [1, 0, 0]) }, model: { generate: async (schema) => { await Bun.sleep(20); return schema.parse({ terms: [] }); } } });
  await expect(engine.ingestContext(input)).rejects.toThrow("connection reset");
  expect(points.size).toBe(0);
});

test("glossary normalizes omitted definitions and aliases while empty indexes use configured dimensions", async () => {
  const { client, calls } = fakeQdrant(768);
  const engine = new QdrantKnowledgeEngine({ client, dimensions: 768, embeddings: { embed: async (texts) => texts.map(() => Array(768).fill(0)) },
    model: { generate: async (schema) => schema.parse({ terms: [{ term: "Current", category: "TERM" }] }) } });
  await engine.ingestContext({ ...input, slides: [] });
  expect((await engine.getGlossary(input.sessionId))[0]).toMatchObject({ term: "Current", definition: null, aliases: [] });
  await engine.ingestContext({ ...input, text: null, slides: [] });
  expect(calls.filter((c) => c.startsWith("create"))).toEqual(["create:768"]);
});

test("a collection with another vector size is rejected with a clear error", async () => {
  const { client } = fakeQdrant(1536);
  const engine = new QdrantKnowledgeEngine({ client, dimensions: 768, embeddings: { embed: async (texts) => texts.map(() => Array(768).fill(0)) }, model: { generate: async (schema) => schema.parse({ terms: [] }) } });
  await client.createCollection("x", { vectors: { size: 1536, distance: "Cosine" } });
  await expect(engine.ingestContext(input)).rejects.toThrow("1536-dim");
});
