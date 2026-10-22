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
