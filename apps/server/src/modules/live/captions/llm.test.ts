import { afterAll, describe, expect, it } from "bun:test";
import { z } from "zod";

import { createMastraGenerate } from "./llm";

/** Minimal OpenAI-compatible chat endpoint standing in for Merge Gateway. */
const requests: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];
let reply = "{}";
const gateway = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as Record<string, unknown>;
    requests.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body });
    const base = { id: "chatcmpl-1", created: 1, model: String(body.model) };
    if (body.stream) {
      const chunks = [
        { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] },
        { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } },
      ];
      const sse = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      ...base,
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  },
});
afterAll(() => gateway.stop(true));

describe("createMastraGenerate → Merge Gateway (OpenAI-compatible)", () => {
  it("sends the full gateway model id with the bearer key and returns the validated object", async () => {
    reply = JSON.stringify({ text: "Could you repeat the formula?", alternatives: [], confidence: 0.9 });
    const generate = createMastraGenerate({
      gateway: { url: `http://localhost:${gateway.port}/v1/openai`, apiKey: "mg_test" },
      captionModel: "zai/glm-5.3-flash",
      signModel: "zai/glm-5.3-flash",
    });
    const schema = z.object({ text: z.string(), alternatives: z.array(z.string()), confidence: z.number() });
    const out = await generate({ task: "sign", prompt: "Gloss: PLEASE REPEAT FORMULA", schema, signal: AbortSignal.timeout(5000) });

    expect(out).toEqual({ text: "Could you repeat the formula?", alternatives: [], confidence: 0.9 });
    const req = requests.at(-1)!;
    expect(req.path).toBe("/v1/openai/chat/completions");
    expect(req.auth).toBe("Bearer mg_test");
    expect(req.body.model).toBe("zai/glm-5.3-flash");
    // Schema is injected into the prompt, so models without json_schema response_format still work.
    expect(JSON.stringify(req.body.messages)).toContain("confidence");
  });

  it("rejects output that does not match the schema (caller falls back)", async () => {
    reply = "not json at all";
    const generate = createMastraGenerate({
      gateway: { url: `http://localhost:${gateway.port}/v1/openai`, apiKey: "mg_test" },
      captionModel: "zai/glm-5.3-flash",
      signModel: "zai/glm-5.3-flash",
    });
    const schema = z.object({ text: z.string() });
    let failed = false;
    try {
      const out = await generate({ task: "captions", prompt: "x", schema, signal: AbortSignal.timeout(5000) });
      failed = !schema.safeParse(out).success;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
