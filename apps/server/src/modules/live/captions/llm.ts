/**
 * OWNER: Ashwath. The single seam between the caption engine and the LLM framework.
 * Production: Mastra agents → withModels (Merge Gateway, or Gemini direct for "gemini/…" ids) → CAPTION_MODEL / SIGN_MODEL
 * (comma-separated lists are hedged).
 * Tests pass a fake.
 */
import { Agent } from "@mastra/core/agent";
import type { z } from "zod";

import { type GatewayConfig, withModels } from "../../../lib/llm-gateway";
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
  /** With a model list ("a,b"), start b when a hasn't answered after this many ms. Default 2500. */
  hedgeMs?: number;
}): StructuredGenerate {
  const tasks: Record<LlmTask, { id: string; name: string; instructions: string; model: string }> = {
    captions: { id: "caption-refiner", name: "Caption refiner", instructions: CAPTION_INSTRUCTIONS, model: options.captionModel },
    sign: { id: "sign-composer", name: "Sign sentence composer", instructions: signInstructions(options.signLanguage ?? "english"), model: options.signModel },
  };

  return async ({ task, prompt, schema, signal }) => {
    const { model: modelId, ...agent } = tasks[task];
    // One Agent per call: cheap, and lets withModel hand each attempt a different (rotated) key.
    // "a,b" model lists are hedged: b races a if a hasn't answered within hedgeMs (live tail latency).
    const result = await withModels(
      options.gateway,
      modelId,
      (model, attemptSignal) =>
        new Agent({ ...agent, model }).generate(prompt, {
          // The schema is injected into the prompt (works for every gateway model, incl. ones without
          // json_schema response_format); the output is still validated against `schema`.
          structuredOutput: { schema, jsonPromptInjection: true },
          abortSignal: attemptSignal,
          // Rotated keys fail over instantly; SDK backoff retries on the same key would only burn the deadline.
          ...(model.providerId === "gemini" ? { modelSettings: { maxRetries: 0 } } : {}),
        } as never),
      { hedgeMs: options.hedgeMs, signal },
    );
    return (result as { object: unknown }).object as z.infer<typeof schema>;
  };
}
