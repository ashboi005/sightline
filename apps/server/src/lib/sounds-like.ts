/**
 * Could `heard` be speech recognition mis-hearing `term`? Shared by the glossary (which aliases to keep), the caption
 * fast path (which aliases to apply) and the LLM guard (which term swaps to accept).
 *
 * Accepts sound-alikes: "kerchief's current law" ~ "Kirchhoff's current law", "mash analysis" ~ "mesh analysis",
 * "homes law" ~ "Ohm's law". Rejects synonyms and other names ("quadratic formula" vs "Sridharacharya's formula",
 * "solutions" vs "roots"), expansions ("KCL" vs "Kirchhoff's current law", "Kirchhoff's laws" vs "Kirchhoff's
 * voltage law") and inflections of real words ("resistors" vs "Resistance").
 */
const words = (s: string) => (s.toLowerCase().replace(/[’']s\b/g, "").match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/s$/, ""));
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < Math.min(a.length, b.length) && a[n] === b[n]) n++;
  return n;
};
const commonSuffix = (a: string, b: string) => commonPrefix([...a].reverse().join(""), [...b].reverse().join(""));
const bigrams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
const dice = (a: string, b: string) => {
  const x = bigrams(a);
  const y = bigrams(b);
  return x.size + y.size === 0 ? 0 : (2 * [...x].filter((g) => y.has(g)).length) / (x.size + y.size);
};

export function soundsLike(heard: string, term: string): boolean {
  const h = heard.trim();
  const t = term.trim();
  if (h.toLowerCase().replace(/[’']/g, "'") === t.toLowerCase().replace(/[’']/g, "'")) return true;
  if (/^[A-Z]{2,6}s?$/.test(h)) return false; // an acronym the speaker actually used
  const hw = words(h);
  const tw = words(t);
  if (hw.length === 0 || tw.length === 0) return false;
  const sameWords = hw.length === tw.length && hw.every((w) => tw.includes(w));
  if (sameWords) return true; // spelling / possessive / plural fix: "Vieta formulas" → "Vieta's formulas"
  if (hw.join("") === tw.join("")) return true; // split or joined words: "Sridhar Acharya" → "Sridharacharya"
  if (hw.every((w) => tw.includes(w))) return false; // the term only adds words: an expansion ("KCL…", "Kirchhoff's laws")
  if (tw.every((w) => hw.includes(w))) return false; // the heard phrase is longer and contains the term: a different phrase
  // A derived form of a real word was heard correctly: same stem, different ending ("resistor" / "resistance",
  // "parabolic" / "parabola"). A misspelling keeps the ending ("kirchoff" / "kirchhoff") and is a real correction.
  if (hw.some((a) => tw.some((b) => a !== b && commonPrefix(a, b) >= 5 && commonSuffix(a, b) <= 1))) return false;
  const shared = hw.filter((w) => tw.includes(w));
  if (shared.length) {
    // Same frame, one part swapped: the swapped parts must look alike ("kerchief" ~ "kirchhoff"), unless they're too
    // short to judge ("homes" / "ohm"). "quadratic" vs "sridharacharya" is a different name.
    const rest = (ws: string[]) => ws.filter((w) => !shared.includes(w)).join("");
    const a = rest(hw);
    const b = rest(tw);
    if (a.length >= 4 && b.length >= 4) return dice(a, b) >= 0.2;
  }
  return dice(hw.join(""), tw.join("")) >= 0.2; // kerchief→Kirchhoff 0.27, unrelated phrases < 0.1
}
