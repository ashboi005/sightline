/**
 * OWNER: Ashwath. The single seam between the caption engine and the LLM framework.
 * Production: Mastra agents → Merge Gateway (OpenAI-compatible) → CAPTION_MODEL / SIGN_MODEL. Tests pass a fake.
 */
import { Agent } from "@mastra/core/agent";
import type { z } from "zod";

import { type GatewayConfig, gatewayModel } from "../../../lib/llm-gateway";
import { CAPTION_INSTRUCTIONS, SIGN_INSTRUCTIONS } from "./prompts";

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
}): StructuredGenerate {
  const agents: Record<LlmTask, Agent> = {
    captions: new Agent({
      id: "caption-refiner",
      name: "Caption refiner",
      instructions: CAPTION_INSTRUCTIONS,
      model: gatewayModel(options.gateway, options.captionModel),
    }),
    sign: new Agent({
      id: "sign-composer",
      name: "Sign sentence composer",
      instructions: SIGN_INSTRUCTIONS,
      model: gatewayModel(options.gateway, options.signModel),
    }),
  };

  return async ({ task, prompt, schema, signal }) => {
    const result = await agents[task].generate(prompt, {
      // The schema is injected into the prompt (works for every gateway model, incl. ones without
      // json_schema response_format); the output is still validated against `schema`.
      structuredOutput: { schema, jsonPromptInjection: true },
      abortSignal: signal,
    } as never);
    return (result as { object: unknown }).object as z.infer<typeof schema>;
  };
}
