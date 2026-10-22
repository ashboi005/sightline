import { expect, test } from "bun:test";
import type { GlossaryTerm } from "@sightline/contracts";

import { refineWithGlossary } from "./glossary-refiner";

const term = (t: string, aliases: string[]): GlossaryTerm => ({ id: "trm_1", term: t, aliases, definition: null, category: "TERM", source: "TEXT" });

test("fixes mis-heard terms but never applies one- or two-letter aliases to ordinary words", () => {
  const glossary = [term("Kirchhoff's current law", ["kerchief's current law"]), term("Current", ["I"]), term("Voltage", ["V", "volts"])];
  const result = refineWithGlossary("I think kerchief's current law is easy, V", glossary);
  expect(result.text).toBe("I think Kirchhoff's current law is easy, V");
  expect(result.corrections).toEqual([{ from: "kerchief's current law", to: "Kirchhoff's current law", reason: "GLOSSARY" }]);
});
