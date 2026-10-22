/**
 * OWNER: Ashwath — the real CaptionEngine. Contract + budgets: docs/contracts/backend-modules.md.
 *
 * refineCaption = glossary fast path (instant, always computed) + LLM pass under a hard deadline.
 * Whatever the LLM returns is validated: formulas must render in KaTeX, terms are linked to glossary ids,
 * corrections are derived (never trusted), and an output that drops too much of the transcript is rejected.
 * Any timeout / failure / rejection returns the glossary result, so captions never block on the LLM.
 */
import type {
  CaptionCorrection,
  CaptionEngine,
  CaptionPart,
  ComposeSentenceInput,
  ComposeSentenceResult,
  GlossaryTerm,
  KnowledgeEngine,
  RefineCaptionInput,
  RefineCaptionResult,
} from "@sightline/contracts";
import katex from "katex";
import { z } from "zod";

import { refineWithGlossary } from "./glossary-refiner";
import type { StructuredGenerate } from "./llm";
import { glossFallback } from "./sign-fallback";

/** Flat part shape: friendlier to provider structured-output modes than a discriminated union. */
export const LlmCaptionOutput = z.object({
  parts: z
    .array(
      z.object({
        kind: z.enum(["text", "term", "formula"]),
        text: z.string(),
        original: z.string().nullable(),
        latex: z.string().nullable(),
        display: z.enum(["INLINE", "BLOCK"]).nullable(),
      }),
    )
    .min(1),
  confidence: z.number().min(0).max(1),
});
export type LlmCaptionOutput = z.infer<typeof LlmCaptionOutput>;

export const LlmSignOutput = z.object({
  text: z.string().min(1),
  alternatives: z.array(z.string()).max(3),
  confidence: z.number().min(0).max(1),
});

export type CaptionEngineOptions = {
  generate: StructuredGenerate;
  knowledge: KnowledgeEngine;
  captionTimeoutMs: number;
  signTimeoutMs?: number;
  /** Ground refinement with KnowledgeEngine.retrieveContext (Tushar's RAG). Glossary is always used. */
  useRag: boolean;
};

const RAG_TIMEOUT_MS = 300;
const MIN_KEPT_WORD_RATIO = 0.6;

export class MastraCaptionEngine implements CaptionEngine {
  readonly name = "mastra";

  constructor(private readonly opts: CaptionEngineOptions) {}

  async refineCaption(input: RefineCaptionInput): Promise<RefineCaptionResult> {
    const deadline = AbortSignal.timeout(this.opts.captionTimeoutMs);
    const glossary = await this.opts.knowledge.getGlossary(input.sessionId).catch(() => [] as GlossaryTerm[]);
    const fast = refineWithGlossary(input.segment.text, glossary);
    if (!input.segment.text.trim()) return fast;

    try {
      const context = this.opts.useRag ? await this.retrieve(input) : [];
      const output = await this.opts.generate({
        task: "captions",
        prompt: buildCaptionPrompt(input, glossary, context),
        schema: LlmCaptionOutput,
        signal: deadline,
      });
      return toRefined(output, glossary, input.segment.text) ?? fast;
    } catch (error) {
      if (!deadline.aborted) console.warn("[captions] LLM refine failed:", error instanceof Error ? error.message : error);
      return fast;
    }
  }

  async composeSignSentence(input: ComposeSentenceInput): Promise<ComposeSentenceResult> {
    try {
      const prompt = [
        `Gloss: ${input.tokens.map((t) => `${t.gloss}${t.kind === "FINGERSPELL" ? "(fingerspelled)" : ""}[${t.confidence.toFixed(2)}]`).join(" ")}`,
        `Signer: ${input.source === "SELF" ? "the deaf student (to be spoken aloud)" : "someone signing to the student"}`,
        input.recentCaptions.length ? `Recent lecture captions:\n${input.recentCaptions.map((c) => `- ${c}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const output = await this.opts.generate({
        task: "sign",
        prompt,
        schema: LlmSignOutput,
        signal: AbortSignal.timeout(this.opts.signTimeoutMs ?? 4000),
      });
      return { text: output.text.trim(), alternatives: output.alternatives.map((a) => a.trim()).filter(Boolean), confidence: output.confidence };
    } catch (error) {
      console.warn("[captions] LLM sign compose failed:", error instanceof Error ? error.message : error);
      return glossFallback(input.tokens);
    }
  }

  private async retrieve(input: RefineCaptionInput) {
    try {
      return await Promise.race([
        this.opts.knowledge.retrieveContext({ sessionId: input.sessionId, query: input.segment.text, limit: 3 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("rag timeout")), RAG_TIMEOUT_MS)),
      ]);
    } catch {
      return [];
    }
  }
}

export function buildCaptionPrompt(
  input: RefineCaptionInput,
  glossary: GlossaryTerm[],
  context: { text: string }[],
): string {
  const terms = glossary
    .slice(0, 80)
    .map((t) => `- ${t.term}${t.aliases.length ? ` (often mis-heard as: ${t.aliases.join(", ")})` : ""}`)
    .join("\n");
  const previous = input.previous.slice(-3).map((s) => `- ${s.text}`).join("\n");
  return [
    terms ? `Glossary:\n${terms}` : "Glossary: (none)",
    context.length ? `Lecture context:\n${context.map((c) => `- ${c.text.slice(0, 400)}`).join("\n")}` : "",
    previous ? `Previous lines:\n${previous}` : "",
    `Transcript to correct:\n${input.segment.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Unicode-aware so Hinglish / Devanagari transcripts are counted correctly by the drop/padding guard.
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function isValidLatex(latex: string): boolean {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findGlossaryId(text: string, glossary: GlossaryTerm[]): string | null {
  const needle = text.trim().toLowerCase();
  const hit = glossary.find(
    (t) => t.term.toLowerCase() === needle || t.aliases.some((a) => a.toLowerCase() === needle) || needle.includes(t.term.toLowerCase()),
  );
  return hit?.id ?? null;
}

/** Validate + convert the LLM output. Returns null when it should be rejected in favour of the fast path. */
export function toRefined(output: LlmCaptionOutput, glossary: GlossaryTerm[], rawText: string): RefineCaptionResult | null {
  const parts: CaptionPart[] = [];
  const corrections: CaptionCorrection[] = [];

  for (const p of output.parts) {
    if (p.kind === "formula" && p.latex && p.latex.trim() && isValidLatex(p.latex)) {
      parts.push({ type: "formula", latex: p.latex.trim(), spoken: p.text, display: p.display ?? "INLINE" });
      corrections.push({ from: p.text, to: p.latex.trim(), reason: "FORMULA" });
    } else if (p.kind === "term" && p.text.trim()) {
      const original = p.original && p.original.trim().toLowerCase() !== p.text.trim().toLowerCase() ? p.original : null;
      parts.push({ type: "term", text: p.text, glossaryTermId: findGlossaryId(p.text, glossary), original });
      if (original) corrections.push({ from: original, to: p.text, reason: "GLOSSARY" });
    } else if (p.text) {
      // Plain text — or a formula/term that failed validation, degraded to the words actually spoken.
      const last = parts[parts.length - 1];
      if (last?.type === "text") last.text += p.text;
      else parts.push({ type: "text", text: p.text });
    }
  }
  if (parts.length === 0) return null;

  // Guard against the model dropping, summarising or padding content: most spoken words must survive (in
  // text/term parts or a formula's "spoken" text) and the output must not grow far beyond the input.
  const outWords = words(parts.map((p) => (p.type === "formula" ? p.spoken : p.text)).join(" "));
  const kept = new Set(outWords);
  const raw = words(rawText);
  if (raw.length > 0 && raw.filter((w) => kept.has(w)).length / raw.length < MIN_KEPT_WORD_RATIO) return null;
  if (outWords.length > raw.length * 1.6 + 3) return null;

  return {
    text: parts.map((p) => (p.type === "formula" ? p.latex : p.text)).join(""),
    parts,
    corrections,
    confidence: Math.min(1, Math.max(0, output.confidence)),
  };
}
