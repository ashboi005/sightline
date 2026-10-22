/**
 * OWNER: Ashwath. Public surface of the intelligence module — the platform module imports ONLY from here.
 */
import type { IntelligenceEngine } from "@sightline/contracts";

import { MastraIntelligenceEngine } from "./mastra-engine";
import { MockIntelligenceEngine } from "./mock-engine";

export function createIntelligenceEngine(opts: { mock: boolean }): IntelligenceEngine {
  return opts.mock ? new MockIntelligenceEngine() : new MastraIntelligenceEngine();
}

export { intelligenceDevRoutes } from "./dev-routes";
