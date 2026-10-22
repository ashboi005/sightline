import { describe, expect, test } from "bun:test";
import type { CaptionSegment } from "@sightline/contracts";

import { applyCaptionMessage, emptyCaptions, upsertCaptions } from "./captions";

const segment = (id: string, seq: number, status: CaptionSegment["status"], text = id): CaptionSegment => ({
  id,
  sessionId: "ses_1",
  seq,
  status,
  startMs: seq * 1000,
  endMs: seq * 1000 + 900,
  speaker: null,
  rawText: text,
  text,
  parts: [{ type: "text", text }],
  corrections: [],
  slidePointer: null,
  confidence: 0.9,
});

describe("caption state", () => {
  test("orders by seq, not arrival", () => {
    const state = upsertCaptions(emptyCaptions, [segment("seg_b", 2, "FINAL"), segment("seg_a", 1, "FINAL")]);
    expect(state.segments.map((s) => s.id)).toEqual(["seg_a", "seg_b"]);
  });

  test("refined replaces in place by id", () => {
    let state = upsertCaptions(emptyCaptions, [segment("seg_a", 1, "FINAL", "kerchief")]);
    state = upsertCaptions(state, [segment("seg_a", 1, "REFINED", "Kirchhoff")]);
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]!.text).toBe("Kirchhoff");
  });

  test("a late final or a backfill never undoes a refinement", () => {
    let state = upsertCaptions(emptyCaptions, [segment("seg_a", 1, "REFINED", "Kirchhoff")]);
    state = upsertCaptions(state, [segment("seg_a", 1, "FINAL", "kerchief")]);
    expect(state.segments[0]!.status).toBe("REFINED");
    expect(state.segments[0]!.text).toBe("Kirchhoff");
  });

  test("the interim line is separate and clears when its segment commits", () => {
    let state = applyCaptionMessage(emptyCaptions, { type: "caption.interim", segmentId: "seg_a", seq: 1, text: "good mor", startMs: 0, ts: 1 });
    expect(state.interim?.text).toBe("good mor");
    expect(state.segments).toHaveLength(0);
    state = applyCaptionMessage(state, { type: "caption.final", segment: segment("seg_a", 1, "FINAL"), ts: 2 });
    expect(state.interim).toBeNull();
  });

  test("an interim for a different segment survives another segment's commit", () => {
    let state = applyCaptionMessage(emptyCaptions, { type: "caption.interim", segmentId: "seg_b", seq: 2, text: "now", startMs: 0, ts: 1 });
    state = applyCaptionMessage(state, { type: "caption.refined", segment: segment("seg_a", 1, "REFINED"), ts: 2 });
    expect(state.interim?.segmentId).toBe("seg_b");
  });
});
