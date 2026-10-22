import type { ComposeSentenceResult, SignToken } from "@sightline/contracts";

const QUESTION_GLOSSES = new Set(["QUESTION", "WHAT", "WHY", "HOW", "WHERE", "WHO", "WHEN"]);

/** Deterministic gloss → sentence used when the LLM is unavailable. Low confidence by design. */
export function glossFallback(tokens: SignToken[]): ComposeSentenceResult {
  const words = tokens.map((t) => (t.kind === "FINGERSPELL" ? t.gloss : t.gloss.toLowerCase().replace(/-/g, " ")));
  const sentence = words.join(" ");
  const isQuestion = tokens.some((t) => QUESTION_GLOSSES.has(t.gloss));
  return {
    text: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${isQuestion ? "?" : "."}`,
    alternatives: [],
    confidence: 0.4,
  };
}
