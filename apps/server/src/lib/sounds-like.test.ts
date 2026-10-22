import { expect, test } from "bun:test";

import { soundsLike } from "./sounds-like";

test("sound-alike mis-hearings are corrections; synonyms, expansions and derived forms are not", () => {
  const corrections: [string, string][] = [
    ["kerchief's", "Kirchhoff's"], ["kerchief", "Kirchhoff"], ["kerchief's current law", "Kirchhoff's current law"],
    ["kirchoffs current law", "Kirchhoff's current law"], ["kirk off", "Kirchhoff"], ["mash analysis", "mesh analysis"],
    ["homes law", "Ohm's law"], ["k c l", "KCL"], ["Sridhar Acharya formula", "Sridharacharya’s formula"],
    ["Vieta formulas", "Vieta’s Formulas"], ["Quadratic Equations", "Quadratic Equation"],
  ];
  const notCorrections: [string, string][] = [
    ["KCL", "Kirchhoff's current law"], ["Kirchhoff's laws", "Kirchhoff's voltage law"], ["resistors", "Resistance"],
    ["sigma I in equals sigma I out", "Conservation of charge"], ["Quadratic formula", "Sridharacharya’s Formula"],
    ["Solutions", "Roots"], ["Delta", "Discriminant"], ["Parabolic graph", "Parabola"], ["Parabolic", "Parabola"],
    ["Standard quadratic form", "Standard Form"], ["Parabola vertex", "Vertex"], ["Constant coefficients", "Coefficients"],
  ];
  expect(corrections.filter(([heard, term]) => !soundsLike(heard, term))).toEqual([]);
  expect(notCorrections.filter(([heard, term]) => soundsLike(heard, term))).toEqual([]);
});
