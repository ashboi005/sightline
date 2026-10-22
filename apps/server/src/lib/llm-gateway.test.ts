import { expect, test } from "bun:test";

import { type GatewayConfig, withModels } from "./llm-gateway";

const gateway: GatewayConfig = { url: "https://merge", apiKey: "mg" };
/** A fake model call: answers after `ms`, or fails; records start order and aborts. */
function fakeModels(plan: Record<string, { ms: number; fail?: boolean }>) {
  const started: string[] = [];
  const aborted: string[] = [];
  const call = (model: { modelId: string }, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      started.push(model.modelId);
      const { ms, fail } = plan[model.modelId]!;
      const timer = setTimeout(() => (fail ? reject(new Error(`${model.modelId} down`)) : resolve(model.modelId)), ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); aborted.push(model.modelId); reject(new Error("aborted")); });
    });
  return { call, started, aborted };
}

test("hedged list: a slow first model is raced by the next one and the loser is aborted", async () => {
  const f = fakeModels({ slow: { ms: 200 }, fast: { ms: 10 } });
  const t = performance.now();
  expect(await withModels(gateway, "slow,fast", f.call, { hedgeMs: 30 })).toBe("fast");
  expect(performance.now() - t).toBeLessThan(150);
  expect(f.started).toEqual(["slow", "fast"]);
  expect(f.aborted).toEqual(["slow"]);
});

test("hedged list: a fast first model never starts the hedge", async () => {
  const f = fakeModels({ a: { ms: 5 }, b: { ms: 5 } });
  expect(await withModels(gateway, "a,b", f.call, { hedgeMs: 50 })).toBe("a");
  await Bun.sleep(80);
  expect(f.started).toEqual(["a"]);
});

test("fallback list: the next model starts only after a failure; all failing rejects with the last error", async () => {
  const f = fakeModels({ a: { ms: 5, fail: true }, b: { ms: 5 } });
  expect(await withModels(gateway, "a, b", f.call)).toBe("b");
  const g = fakeModels({ a: { ms: 5, fail: true }, b: { ms: 5, fail: true } });
  await expect(withModels(gateway, "a,b", g.call)).rejects.toThrow("b down");
});

test("the caller's deadline aborts every attempt", async () => {
  const f = fakeModels({ a: { ms: 500 }, b: { ms: 500 } });
  await expect(withModels(gateway, "a,b", f.call, { hedgeMs: 10, signal: AbortSignal.timeout(40) })).rejects.toThrow();
  expect(f.aborted.sort()).toEqual(["a", "b"]);
});
