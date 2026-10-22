import { expect, test } from "bun:test";
import { z } from "zod";
import { KeyPool } from "../../../lib/key-pool";
import { MastraStructuredModel, OpenAIEmbeddings } from "./structured-model";

test("platform gateway calls honor the configured deadline", async () => {
  const gateway = Bun.serve({ port: 0, async fetch() {
    await Bun.sleep(300);
    return Response.json({ id: "chat_test", object: "chat.completion", created: 0, model: "zai/glm-5.3-flash", choices: [{ index: 0, message: { role: "assistant", content: '{"term":"Current"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  } });
  try {
    const model = new MastraStructuredModel({ url: `http://localhost:${gateway.port}/v1`, apiKey: "test" }, "zai/glm-5.3-flash", { timeoutMs: 25 });
    await expect(model.generate(z.object({ term: z.string() }), "Extract term", {})).rejects.toThrow();
  } finally { gateway.stop(true); }
});

test("Gemini-compatible embedding batches request float vectors and configured dimensions", async () => {
  const gateway = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as { encoding_format: string; dimensions: number; input: string[] };
    if (body.encoding_format !== "float" || body.dimensions !== 3) return new Response("bad vector configuration", { status: 400 });
    return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })).reverse(), model: "gemini-embedding-001", usage: { prompt_tokens: 1, total_tokens: 1 } });
  } });
  try {
    const embeddings = new OpenAIEmbeddings("test", "gemini-embedding-001", { baseURL: `http://localhost:${gateway.port}/v1`, dimensions: 3 });
    expect(await embeddings.embed(["Current", "Voltage"])).toEqual([[1, 0, 0], [1, 0, 0]]);
  } finally { gateway.stop(true); }
});

test("embeddings rotate keys on 429 and fall back to the same model via another provider when all are limited", async () => {
  const keysSeen: string[] = [];
  const gemini = Bun.serve({ port: 0, async fetch(request) {
    keysSeen.push(request.headers.get("authorization") ?? "");
    return Response.json({ error: { code: 429, message: "quota", details: [{ retryDelay: "30s" }] } }, { status: 429 });
  } });
  let fallbackModel = "";
  const merge = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as { model: string; input: string[] };
    fallbackModel = body.model;
    return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [0, 1, 0] })), model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } });
  } });
  try {
    const embeddings = new OpenAIEmbeddings(new KeyPool("gemini", ["k1", "k2"]), "gemini-embedding-001", {
      baseURL: `http://localhost:${gemini.port}/v1`, dimensions: 3,
      fallback: { baseURL: `http://localhost:${merge.port}/v1`, apiKey: "mg", model: "google/gemini-embedding-001" },
    });
    expect(await embeddings.embed(["Current"])).toEqual([[0, 1, 0]]);
    expect(keysSeen).toEqual(["Bearer k1", "Bearer k2"]);
    expect(fallbackModel).toBe("google/gemini-embedding-001");
    const noFallback = new OpenAIEmbeddings(new KeyPool("gemini", ["k3"]), "gemini-embedding-001", { baseURL: `http://localhost:${gemini.port}/v1` });
    await expect(noFallback.embed(["x"])).rejects.toThrow();
    await expect(noFallback.embed(["x"])).rejects.toThrow("rate-limited");
  } finally { gemini.stop(true); merge.stop(true); }
});
