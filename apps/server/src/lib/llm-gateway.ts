/**
 * Shared: every LLM call (Ashwath's captions/sign/vision, Tushar's notes/glossary) goes through Merge Gateway's
 * OpenAI-compatible endpoint. Model ids are gateway ids such as "zai/glm-5.3-flash".
 *
 *   new Agent({ ..., model: gatewayModel(config.llm, ENV.CAPTION_MODEL) })
 */
export type GatewayConfig = { url: string; apiKey: string | undefined };

/** Mastra OpenAI-compatible model config. The full gateway id is sent as the `model` field. */
export function gatewayModel(gateway: GatewayConfig, modelId: string) {
  return {
    providerId: "merge-gateway",
    modelId,
    url: gateway.url.replace(/\/$/, ""),
    // Mastra requires a key string; a missing key fails at request time and callers fall back.
    apiKey: gateway.apiKey ?? "missing-MERGE_GATEWAY_API_KEY",
  };
}
