/**
 * OWNER: Ashwath. One-line description of a board/diagram snapshot for the notes, via the gateway's vision model
 * (VISION_MODEL, default zai/glm-4.5v). Best-effort: failures leave `description` null.
 */
import { Agent } from "@mastra/core/agent";

import { type GatewayConfig, gatewayModel } from "../../../lib/llm-gateway";

export interface VisionDescriber {
  readonly name: string;
  describe(image: Uint8Array, mimeType: string, context: string): Promise<string | null>;
}

const INSTRUCTIONS = `You describe a photo of a classroom board or projected slide for a deaf student's lecture notes.
Write ONE concise line (max 25 words) that says what is drawn or written: the diagram type and the key labels,
values and equations you can read. Do not guess unreadable text. No preamble.`;

export class GatewayVisionDescriber implements VisionDescriber {
  readonly name = "gateway-vision";
  private readonly agent: Agent;

  constructor(
    gateway: GatewayConfig,
    model: string,
    private readonly timeoutMs = 15_000,
  ) {
    this.agent = new Agent({
      id: "snapshot-describer",
      name: "Snapshot describer",
      instructions: INSTRUCTIONS,
      model: gatewayModel(gateway, model),
    });
  }

  async describe(image: Uint8Array, mimeType: string, context: string): Promise<string | null> {
    try {
      const result = await this.agent.generate(
        [
          {
            role: "user",
            content: [
              { type: "text", text: context ? `What the teacher was saying: ${context}` : "Describe the board." },
              { type: "image", image, mimeType },
            ],
          },
        ] as never,
        { abortSignal: AbortSignal.timeout(this.timeoutMs) } as never,
      );
      const text = (result as { text?: string }).text?.trim();
      return text ? text.replace(/\s+/g, " ").slice(0, 240) : null;
    } catch (error) {
      console.warn("[snapshots] vision describe failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }
}

/** Mock: no model call — describes from the teacher's words so notes still read naturally. */
export class MockVisionDescriber implements VisionDescriber {
  readonly name = "mock";

  async describe(_image: Uint8Array, _mimeType: string, context: string): Promise<string | null> {
    return context ? `Board snapshot: ${context.slice(0, 120)}` : "Board snapshot";
  }
}
