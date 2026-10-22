/**
 * OWNER: Ashwath. The single seam between the caption engine and the LLM framework.
 * Production uses Mastra agents (model router: "provider/model", keys from env); tests pass a fake.
 */
import { Agent } from "@mastra/core/agent";
import type { z } from "zod";

import { CAPTION_INSTRUCTIONS, SIGN_INSTRUCTIONS } from "./prompts";

export type LlmTask = "captions" | "sign";

export type StructuredGenerate = <T extends z.ZodType>(request: {
  task: LlmTask;
  prompt: string;
  schema: T;
  signal: AbortSignal;
}) => Promise<z.infer<T>>;

export function createMastraGenerate(models: { captionModel: string; signModel: string }): StructuredGenerate {
  const agents: Record<LlmTask, Agent> = {
    captions: new Agent({
      id: "caption-refiner",
      name: "Caption refiner",
      instructions: CAPTION_INSTRUCTIONS,
      model: models.captionModel,
    }),
    sign: new Agent({
      id: "sign-composer",
      name: "Sign sentence composer",
      instructions: SIGN_INSTRUCTIONS,
      model: models.signModel,
    }),
  };

  return async ({ task, prompt, schema, signal }) => {
    const result = await agents[task].generate(prompt, {
      structuredOutput: { schema },
      abortSignal: signal,
    } as never);
    return (result as { object: unknown }).object as z.infer<typeof schema>;
  };
}
