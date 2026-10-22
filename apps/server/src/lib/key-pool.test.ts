import { expect, test } from "bun:test";

import { cooldownFor, httpFailure, KeyPool } from "./key-pool";
import { type GatewayConfig, gatewayModel, withModel } from "./llm-gateway";

const apiError = (statusCode: number, responseBody = "") => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, responseBody });

test("cooldowns follow Gemini's status semantics", () => {
  expect(cooldownFor(429, '{"retryDelay": "7s"}')).toMatchObject({ ms: 7500, reason: "rate limited" });
  expect(cooldownFor(429, "GenerateRequestsPerDayPerProjectPerModel")).toMatchObject({ ms: 3_600_000 });
  expect(cooldownFor(400, "Please pass a valid API key")).toMatchObject({ allModels: true });
  expect(cooldownFor(503, "")).toMatchObject({ ms: 5000 });
  expect(cooldownFor(400, "bad schema")).toBeNull();
  expect(httpFailure({ cause: apiError(503, "busy") })).toEqual({ status: 503, body: "busy" });
});

test("round-robin skips keys cooling for that model only", () => {
  const pool = new KeyPool("gemini", ["a", "b", "b", undefined, ""]);
  expect(pool.size).toBe(2);
  const first = pool.next("m1")!;
  pool.cool(first, "m1", { ms: 60_000, reason: "rate limited" });
  expect(pool.next("m1")?.key).toBe("b");
  expect(pool.next("m1")?.key).toBe("b");
  expect(pool.next("m2")?.key).toBe("a"); // other model unaffected
});

test("withModel rotates Gemini keys on 429/503, then falls back to Merge google/<model>", async () => {
  const pool = new KeyPool("gemini", ["k1", "k2"]);
  const gateway: GatewayConfig = { url: "https://merge/v1/openai", apiKey: "mg", gemini: { url: "https://gemini/openai/", pool } };
  const seen: string[] = [];
  const result = await withModel(gateway, "gemini/flash-lite", async (model) => {
    seen.push(`${model.providerId}:${model.modelId}:${model.apiKey}`);
    if (model.providerId === "gemini") throw apiError(model.apiKey === "k1" ? 429 : 503);
    return "ok";
  });
  expect(result).toBe("ok");
  expect(seen).toEqual(["gemini:flash-lite:k1", "gemini:flash-lite:k2", "merge-gateway:google/flash-lite:mg"]);
  expect(pool.next("flash-lite")).toBeNull(); // both cooling
});

test("withModel does not rotate on non-key errors and passes Merge ids straight through", async () => {
  const gateway: GatewayConfig = { url: "https://merge", apiKey: "mg", gemini: { url: "https://gemini", pool: new KeyPool("gemini", ["k1", "k2"]) } };
  let calls = 0;
  await expect(withModel(gateway, "gemini/x", async () => { calls++; throw apiError(400, "bad request"); })).rejects.toThrow("HTTP 400");
  expect(calls).toBe(1);
  expect(await withModel(gateway, "zai/glm-5.3-flash", async (m) => m.modelId)).toBe("zai/glm-5.3-flash");
  expect(gatewayModel({ url: "u", apiKey: undefined }, "gemini/y").modelId).toBe("google/y"); // no Gemini pool → Merge
});
