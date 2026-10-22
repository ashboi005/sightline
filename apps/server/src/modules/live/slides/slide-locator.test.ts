import { describe, expect, it } from "bun:test";
import { fixtures } from "@sightline/mocks";
import { toSlideBullets } from "@sightline/mocks";

import { buildIndex, locateIn, tokenize } from "./slide-locator";

const slides = fixtures.lecture.slides.slides.map((s) => ({ index: s.index, title: s.title, bullets: toSlideBullets(s.bullets) }));
const index = buildIndex("dck_test", slides);
const tuning = { minScore: 0.18, switchMargin: 0.08 };

describe("tokenize", () => {
  it("normalises symbols, LaTeX and plurals", () => {
    expect(tokenize("\\sum_{k=1}^{n} I_k = 0")).toEqual(["sum", "1", "0"]); // single-letter variables are noise
    expect(tokenize("Σ I_k")).toContain("sum");
    expect(tokenize("4 ohms (Ω)")).toEqual(["4", "ohm", "ohm"]);
    expect(tokenize("Kirchhoff's laws")).toEqual(["kirchhoff", "law"]);
  });
});

describe("locateIn (Kirchhoff golden set)", () => {
  it("tracks the fixture's slide pointers through the lecture", () => {
    let current: number | null = null;
    let compared = 0;
    let correct = 0;
    for (const seg of fixtures.lecture.script.segments) {
      const pointer = locateIn(index, seg.refined.text, current, tuning);
      if (pointer) current = pointer.slideIndex;
      if (seg.slidePointer) {
        compared++;
        if (current === seg.slidePointer.slideIndex) correct++;
      }
    }
    const accuracy = correct / compared;
    console.log(`slide accuracy ${correct}/${compared} = ${(accuracy * 100).toFixed(0)}%`);
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it("finds the right bullet on a clear match", () => {
    const pointer = locateIn(index, "Power dissipated in each resistor is P = I^2 R.", null, tuning);
    expect(pointer).toMatchObject({ slideIndex: 4, bulletIndex: 2 });
  });

  it("stays on the current slide for chit-chat instead of jumping", () => {
    expect(locateIn(index, "Okay, any questions so far?", 3, tuning)).toBeNull();
    expect(locateIn(index, "Let me draw an example on the board.", null, tuning)).toBeNull();
  });
});
