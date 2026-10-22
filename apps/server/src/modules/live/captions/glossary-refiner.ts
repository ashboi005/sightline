/**
 * OWNER: Ashwath. Deterministic fast path for caption correction: replace known mis-hearings (glossary
 * aliases) with the canonical term, as `term` parts. Instant, no LLM — usable as the first pass of the real
 * engine and as the mock's fallback for text that is not in the fixtures.
 */
import type { CaptionCorrection, CaptionPart, GlossaryTerm, RefineCaptionResult } from "@sightline/contracts";

import { soundsLike } from "../../../lib/sounds-like";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function refineWithGlossary(text: string, glossary: GlossaryTerm[]): RefineCaptionResult {
  const corrections: CaptionCorrection[] = [];
  const parts: CaptionPart[] = [];
  const aliases = glossary
    // Only sound-alike mis-hearings: an alias under 3 letters ("I" for current) or a synonym ("quadratic formula" for
    // "Sridharacharya's formula") would rewrite correctly heard words.
    .flatMap((term) => term.aliases.filter((alias) => alias.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 && soundsLike(alias, term.term)).map((alias) => ({ pattern: new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i"), term })))
    .sort((a, b) => b.pattern.source.length - a.pattern.source.length);

  let rest = text;
  while (rest.length > 0) {
    let earliest: { index: number; matched: string; term: GlossaryTerm } | null = null;
    for (const { pattern, term } of aliases) {
      const match = pattern.exec(rest);
      if (match && (!earliest || match.index < earliest.index)) earliest = { index: match.index, matched: match[0], term };
    }
    if (!earliest) {
      parts.push({ type: "text", text: rest });
      break;
    }
    if (earliest.index > 0) parts.push({ type: "text", text: rest.slice(0, earliest.index) });
    parts.push({ type: "term", text: earliest.term.term, glossaryTermId: earliest.term.id, original: earliest.matched });
    corrections.push({ from: earliest.matched, to: earliest.term.term, reason: "GLOSSARY" });
    rest = rest.slice(earliest.index + earliest.matched.length);
  }

  const first = parts[0];
  if (first?.type === "text") first.text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
  return {
    text: parts.map((p) => (p.type === "formula" ? p.latex : p.text)).join(""),
    parts,
    corrections,
    confidence: corrections.length > 0 ? 0.7 : 0.6,
  };
}
