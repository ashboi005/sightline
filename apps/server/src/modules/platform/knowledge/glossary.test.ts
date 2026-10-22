import { expect, test } from "bun:test";

import { deterministicGlossary, normalizeGlossary } from "./glossary";

const slides = [{ id: "sld_0", index: 0, imageUrl: "x", title: "Kirchhoff's Current Law (KCL)", text: "The sum of currents entering a node equals the sum leaving it", bullets: [] }];

test("normalizes LLM terms into short canonical names with safe aliases", () => {
  const terms = normalizeGlossary({
    terms: [
      { term: "Kirchhoff's Current Law (KCL)", aliases: ["kerchief's current law", "I", "law"], category: "law", definition: "Currents at a node sum to zero." },
      { term: "Kirchhoff's current law", aliases: ["duplicate"] },
      { term: "P = I^2 R", aliases: [] },
      { term: "Mesh analysis", aliases: null, category: "weird", definition: null },
    ],
  }, { slides });
  expect(terms.map((t) => ({ term: t.term, aliases: t.aliases, category: t.category, source: t.source }))).toEqual([
    { term: "Kirchhoff's Current Law", aliases: ["KCL", "kerchief's current law"], category: "LAW", source: "SLIDES" },
    { term: "Mesh analysis", aliases: [], category: "TERM", source: "TEXT" },
  ]);
  expect(terms.every((t) => /^trm_/.test(t.id))).toBe(true);
});

test("deterministic glossary finds named laws, their acronyms and analysis methods without an LLM", () => {
  const draft = deterministicGlossary({ text: "Ohm's law: V = IR. Kirchhoff's voltage law (KVL) sums voltages. Then mesh analysis.", slides });
  const names = draft.terms.map((t) => t.term);
  expect(names).toContain("Ohm's law");
  expect(draft.terms.find((t) => t.term === "Kirchhoff's voltage law")?.aliases).toEqual(["KVL"]);
  expect(names).toContain("mesh analysis");
  expect(names).toContain("Kirchhoff's Current Law");
  expect(names.every((n) => n.length <= 40)).toBe(true);
});
