/**
 * Fixture-backed CaptionEngine. Used when MOCK_CAPTIONS=true.
 *
 * - Known lecture lines (fixtures/kirchhoff.script.json) get their hand-written refined output.
 * - Anything else (e.g. real Deepgram text) goes through the glossary fast path.
 */
import type {
  CaptionEngine,
  ComposeSentenceInput,
  ComposeSentenceResult,
  KnowledgeEngine,
  RefineCaptionInput,
  RefineCaptionResult,
} from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import { refineWithGlossary } from "./glossary-refiner";

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const scriptByRaw = new Map(fixtures.lecture.script.segments.map((s) => [normalize(s.raw), s]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockCaptionEngine implements CaptionEngine {
  readonly name = "mock";

  constructor(private readonly knowledge: KnowledgeEngine) {}

  async refineCaption(input: RefineCaptionInput): Promise<RefineCaptionResult> {
    await sleep(250 + Math.random() * 350); // simulated LLM latency
    const known = scriptByRaw.get(normalize(input.segment.text));
    if (known) return known.refined;
    const glossary = await this.knowledge.getGlossary(input.sessionId).catch(() => []);
    return refineWithGlossary(input.segment.text, glossary);
  }

  async composeSignSentence(input: ComposeSentenceInput): Promise<ComposeSentenceResult> {
    await sleep(300);
    const key = input.tokens.map((t) => t.gloss).join(" ");
    const phrase = fixtures.sign.phrases.find((p) => p.tokens.map((t) => t.gloss).join(" ") === key);
    if (phrase) return { text: phrase.text, alternatives: phrase.alternatives, confidence: 0.9 };

    const words = input.tokens.map((t) => (t.kind === "FINGERSPELL" ? t.gloss : t.gloss.toLowerCase().replace(/-/g, " ")));
    const sentence = words.join(" ");
    const isQuestion = input.tokens.some((t) => ["QUESTION", "WHAT", "WHY", "HOW", "WHERE"].includes(t.gloss));
    return {
      text: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${isQuestion ? "?" : "."}`,
      alternatives: [],
      confidence: 0.4,
    };
  }
}
