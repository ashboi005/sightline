/**
 * Glossary extraction for a lecture context: the LLM prompt + output schema, normalisation into contract
 * GlossaryTerms, and a deterministic fallback. Used by QdrantKnowledgeEngine.ingestContext (and
 * scripts/bench-models.ts, to compare models on the same request).
 *
 * Terms feed the caption refiner (alias → term) and STT keyterms, so they must be short and canonical:
 * "Kirchhoff's voltage law" with aliases ["KVL", "kerchief's voltage law"], never "Kirchhoff's voltage law (KVL)".
 * A one-letter alias ("I" for current) would rewrite every "I" in the captions, so those are dropped.
 */
import { randomUUID } from "node:crypto";

import { GlossaryCategory, type GlossaryTerm, type IngestContextInput } from "@sightline/contracts";
import { z } from "zod";

import type { KnowledgeChunk } from "./chunks";

const MAX_TERMS = 30;

/** What the LLM returns. Lenient on purpose (nullish everywhere): normalizeGlossary does the strict part. */
export const GlossaryDraft = z.object({
  terms: z
    .array(
      z.object({
        term: z.string(),
        aliases: z.array(z.string()).nullish(),
        category: z.string().nullish(),
        definition: z.string().nullish(),
      }),
    )
    .max(60),
  topics: z.array(z.string()).nullish(),
});
export type GlossaryDraft = z.infer<typeof GlossaryDraft>;

export const GLOSSARY_INSTRUCTIONS = `Build the glossary that live captions for this lecture must spell correctly.
Return at most ${MAX_TERMS} terms, most important first, only terms present in the excerpts:
- term: the canonical name, at most 40 characters, no brackets, no formulas (e.g. "Kirchhoff's voltage law", "Thevenin equivalent").
- aliases: acronyms and how speech recognition may mis-hear the term (e.g. "KVL", "kerchief's voltage law").
  Never a single letter, a symbol or a common English word.
- category: one of ${GlossaryCategory.options.join(", ")}.
- definition: at most 12 words.
Also return up to 8 short lecture topics. Never invent content.`;

export function glossaryInput(input: Pick<IngestContextInput, "title" | "subject">, chunks: KnowledgeChunk[]) {
  return { title: input.title, subject: input.subject, excerpts: chunks.map((chunk) => chunk.text).slice(0, 120) };
}

const COMMON = new Set(["the", "and", "law", "laws", "sum", "node", "loop", "current", "voltage", "power", "charge", "energy", "time", "rule", "point", "value", "next", "class", "recap"]);

/** Contract GlossaryTerms from an LLM draft: canonical terms, safe aliases, deduped, sourced. */
export function normalizeGlossary(draft: GlossaryDraft, input: Pick<IngestContextInput, "slides">): GlossaryTerm[] {
  const slideText = input.slides.map((s) => `${s.title ?? ""}\n${s.text}`).join("\n").toLowerCase();
  const seen = new Set<string>();
  const terms: GlossaryTerm[] = [];
  for (const raw of draft.terms) {
    const brackets = [...raw.term.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    const term = raw.term.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (term.length < 2 || /[=^_\\]/.test(term) || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const aliases = [...new Set([...brackets, ...(raw.aliases ?? [])].map((a) => a.trim()))].filter(
      (a) => a.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 && a.toLowerCase() !== term.toLowerCase() && !COMMON.has(a.toLowerCase()) && !/[=^_\\]/.test(a),
    );
    const category = GlossaryCategory.safeParse(raw.category?.toUpperCase()).data ?? (/\blaw\b/i.test(term) ? "LAW" : "TERM");
    terms.push({
      id: `trm_${terms.length}_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      term,
      aliases,
      definition: raw.definition?.trim() || null,
      category,
      source: slideText.includes(term.toLowerCase()) ? "SLIDES" : "TEXT",
    });
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/**
 * No-LLM glossary from the context itself: acronyms, "X's law/rule/theorem"-style names and slide titles.
 * Used when the LLM fails or is too slow, so captions still get keyterms and the context still turns READY.
 */
export function deterministicGlossary(input: Pick<IngestContextInput, "text" | "slides">): GlossaryDraft {
  const text = [input.text ?? "", ...input.slides.flatMap((s) => [s.title ?? "", s.text])].join("\n");
  const terms = new Map<string, { term: string; aliases: string[]; category: string }>();
  const add = (term: string, category: string, alias?: string) => {
    const clean = term.replace(/\s+/g, " ").replace(/^[^\p{L}]+|[^\p{L}\p{N}']+$/gu, "").trim();
    if (clean.length < 3 || clean.length > 40) return;
    const entry = terms.get(clean.toLowerCase()) ?? { term: clean, aliases: [], category };
    if (alias && !entry.aliases.includes(alias)) entry.aliases.push(alias);
    terms.set(clean.toLowerCase(), entry);
  };
  // "Kirchhoff's current law (KCL)" / "Ohm's law" / "Thevenin's theorem"
  for (const m of text.matchAll(/\b((?:\p{Lu}[\p{L}]+(?:'s)?\s+){1,2}(?:[\p{L}]+\s+)?(?:law|rule|theorem|principle|equation|analysis|effect))\b(?:\s*\(([A-Z]{2,6})\))?/giu)) {
    if (/^\p{Lu}/u.test(m[1]!)) add(m[1]!, /law/i.test(m[1]!) ? "LAW" : "TERM", m[2]);
  }
  // Mesh analysis, Nodal analysis etc. written lowercase
  for (const m of text.matchAll(/\b([a-z]+ (?:analysis|theorem|equivalent))\b/g)) add(m[1]!, "TERM");
  // Bare acronyms not attached to a term above
  const attached = new Set([...terms.values()].flatMap((t) => t.aliases));
  for (const m of text.matchAll(/\b([A-Z]{2,6})\b/g)) if (!attached.has(m[1]!)) add(m[1]!, "TERM");
  // Slide titles minus "Recap:"-style prefixes
  for (const slide of input.slides) if (slide.title) add(slide.title.replace(/^[^:]{1,20}:\s*/, "").replace(/\([^)]*\)/g, ""), "TERM");
  return { terms: [...terms.values()].slice(0, MAX_TERMS), topics: input.slides.map((s) => s.title).filter((t): t is string => !!t).slice(0, 8) };
}
