/**
 * Shared: every LLM call (Ashwath's captions/sign/vision, Tushar's notes/glossary) is routed by model id:
 *
 *   "gemini/<model>"  → Gemini direct (OpenAI-compatible endpoint), GEMINI_API_KEY…_4 rotated per call with
 *                       per-key cooldowns (lib/key-pool.ts). When every key is cooling, the same model runs
 *                       through Merge as "google/<model>".
 *   anything else     → Merge Gateway (OpenAI-compatible), e.g. "zai/glm-5.3-flash".
 *
 *   await withModel(config.llm, ENV.CAPTION_MODEL, (model) => new Agent({ ..., model }).generate(...))
 */
import { type Cooldown, cooldownFor, httpFailure, type KeyPool, type PooledKey } from "./key-pool";

export type GatewayConfig = {
  url: string;
  apiKey: string | undefined;
  /** Gemini direct for "gemini/…" model ids. Without it those ids go to Merge as "google/…". */
  gemini?: { url: string; pool: KeyPool };
};

export type MastraModelConfig = { providerId: string; modelId: string; url: string; apiKey: string };

/** Mastra OpenAI-compatible model config for Merge. The full gateway id is sent as the `model` field. */
export function gatewayModel(gateway: GatewayConfig, modelId: string): MastraModelConfig {
  return {
    providerId: "merge-gateway",
    modelId: modelId.startsWith("gemini/") ? `google/${modelId.slice("gemini/".length)}` : modelId,
    url: gateway.url.replace(/\/$/, ""),
    // Mastra requires a key string; a missing key fails at request time and callers fall back.
    apiKey: gateway.apiKey ?? "missing-MERGE_GATEWAY_API_KEY",
  };
}

/**
 * Runs `call` with the model config for `modelId`. Gemini ids rotate keys: a key that 429s/5xxs/is invalid cools
 * down (for this model) and the same call moves straight to the next healthy key; when none is left the call runs
 * once more through Merge. Other failures (bad request, abort/timeout) are thrown unchanged.
 */
export async function withModel<T>(gateway: GatewayConfig, modelId: string, call: (model: MastraModelConfig) => Promise<T>): Promise<T> {
  const gemini = modelId.startsWith("gemini/") ? gateway.gemini : undefined;
  if (!gemini?.pool.size) return call(gatewayModel(gateway, modelId));

  const model = modelId.slice("gemini/".length);
  const tried = new Set<PooledKey>();
  let lastError: unknown = null;
  for (let key = gemini.pool.next(model, tried); key; key = gemini.pool.next(model, tried)) {
    tried.add(key);
    try {
      return await call({ providerId: "gemini", modelId: model, url: gemini.url.replace(/\/$/, ""), apiKey: key.key });
    } catch (error) {
      const failure = httpFailure(error);
      const cooldown: Cooldown | null = failure ? cooldownFor(failure.status, failure.body) : null;
      if (!cooldown) throw error;
      gemini.pool.cool(key, model, cooldown);
      lastError = error;
    }
  }
  if (!gateway.apiKey) throw lastError ?? new Error(`gemini: every key is cooling down for ${model}`);
  console.warn(`[llm] gemini keys exhausted for ${model}; falling back to Merge google/${model}`);
  return call(gatewayModel(gateway, modelId));
}

/**
 * Model lists: "a,b,c" in any *_MODEL env var. Without `hedgeMs` it is a plain fallback chain (b only runs if a
 * fails). With `hedgeMs` (live captions/sign) a slow model is raced: b also starts if a hasn't answered after
 * `hedgeMs`, or as soon as a fails; the first success wins and the others are aborted. Every attempt goes through
 * withModel, so "gemini/…" entries still rotate keys.
 */
export async function withModels<T>(
  gateway: GatewayConfig,
  models: string,
  call: (model: MastraModelConfig, signal: AbortSignal) => Promise<T>,
  options: { hedgeMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const ids = models.split(",").map((m) => m.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("No LLM model configured");
  const controllers = ids.map(() => new AbortController());
  const signals = controllers.map((c) => (options.signal ? AbortSignal.any([options.signal, c.signal]) : c.signal));

  return new Promise<T>((resolve, reject) => {
    let next = 0;
    let running = 0;
    let settled = false;
    let lastError: unknown = null;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void, winner = -1) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      controllers.forEach((c, i) => i !== winner && c.abort());
      fn();
    };
    const launch = () => {
      if (settled || next >= ids.length || options.signal?.aborted) return;
      const index = next++;
      running++;
      clearTimeout(hedgeTimer);
      if (options.hedgeMs !== undefined && next < ids.length) hedgeTimer = setTimeout(launch, options.hedgeMs);
      withModel(gateway, ids[index]!, (model) => call(model, signals[index]!)).then(
        (value) => finish(() => resolve(value), index),
        (error) => {
          running--;
          if (!settled && !signals[index]!.aborted) console.warn(`[llm] ${ids[index]} failed${next < ids.length ? `, trying ${ids[next]}` : ""}:`, error instanceof Error ? error.message.slice(0, 160) : error);
          lastError = error;
          if (next < ids.length && !options.signal?.aborted) launch();
          else if (running === 0) finish(() => reject(lastError));
        },
      );
    };
    options.signal?.addEventListener("abort", () => finish(() => reject(options.signal!.reason ?? lastError)), { once: true });
    launch();
  });
}
