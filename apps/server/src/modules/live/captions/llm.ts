/**
 * OWNER: Ashwath. The single seam between the caption engine and the LLM framework.
 * Production: Mastra agents → withModel (Merge Gateway, or Gemini direct for "gemini/…" ids) → CAPTION_MODEL / SIGN_MODEL.
 * Tests pass a fake.
 */
import { Agent } from "@mastra/core/agent";
import type { z } from "zod";

import { type GatewayConfig, withModel } from "../../../lib/llm-gateway";
import { CAPTION_INSTRUCTIONS, type SignLanguage, signInstructions } from "./prompts";

export type LlmTask = "captions" | "sign";

export type StructuredGenerate = <T extends z.ZodType>(request: {
  task: LlmTask;
  prompt: string;
  schema: T;
  signal: AbortSignal;
}) => Promise<z.infer<T>>;

export function createMastraGenerate(options: {
  gateway: GatewayConfig;
  captionModel: string;
  signModel: string;
  signLanguage?: SignLanguage;
}): StructuredGenerate {
  const tasks: Record<LlmTask, { id: string; name: string; instructions: string; model: string }> = {
    captions: { id: "caption-refiner", name: "Caption refiner", instructions: CAPTION_INSTRUCTIONS, model: options.captionModel },
    sign: { id: "sign-composer", name: "Sign sentence composer", instructions: signInstructions(options.signLanguage ?? "english"), model: options.signModel },
  };

  return async ({ task, prompt, schema, signal }) => {
    const { model: modelId, ...agent } = tasks[task];
    // One Agent per call: cheap, and lets withModel hand each attempt a different (rotated) key.
    const result = await withModel(options.gateway, modelId, (model) =>
      new Agent({ ...agent, model }).generate(prompt, {
        // The schema is injected into the prompt (works for every gateway model, incl. ones without
        // json_schema response_format); the output is still validated against `schema`.
        structuredOutput: { schema, jsonPromptInjection: true },
        abortSignal: signal,
        // Rotated keys fail over instantly; SDK backoff retries on the same key would only burn the deadline.
        ...(model.providerId === "gemini" ? { modelSettings: { maxRetries: 0 } } : {}),
      } as never),
    );
    return (result as { object: unknown }).object as z.infer<typeof schema>;
  };
}
