import { describe, expect, it } from "bun:test";
import type { NoteSection, Snapshot } from "@sightline/contracts";

import { placeSnapshots } from "./mock-notes-engine";

const section = (id: string, slideIndexes: number[], segs: string[]): NoteSection => ({
  id, heading: id, blocks: [{ type: "paragraph", text: "x" }, { type: "paragraph", text: "y" }],
  sourceSegmentIds: segs, slideIndexes, boardFocus: null,
});
const snap = (id: string, segmentIds: string[], atMs: number): Snapshot => ({
  id, sessionId: "ses_1", imageUrl: `http://x/${id}`, trigger: "SPEECH_CUE", reason: "r", capturedAt: 0, atMs, segmentIds, description: "desc",
});

describe("placeSnapshots", () => {
  it("puts a snapshot in the section owning its captions, after the first block", () => {
    const sections = [section("kcl", [2], ["seg_a"]), section("kvl", [3], ["seg_b"])];
    placeSnapshots(sections, [snap("snp_1", ["seg_b"], 60_000)], []);
    expect(sections[1]!.blocks[1]).toEqual({ type: "image", snapshotId: "snp_1", url: "http://x/snp_1", caption: "desc" });
    expect(sections[0]!.blocks).toHaveLength(2);
  });

  it("falls back to the slide being explained at capture time", () => {
    const sections = [section("kcl", [2], []), section("kvl", [3], [])];
    const transcript = [{ id: "seg_z", startMs: 10_000, slidePointer: { slideIndex: 2, bulletIndex: null, confidence: 1 } }] as never;
    placeSnapshots(sections, [snap("snp_2", [], 12_000)], transcript);
    expect(sections[0]!.blocks.some((b) => b.type === "image")).toBe(true);
  });

  it("uses caption time without slides, greatest overlap, stable image order and no duplicates", () => {
    const sections = [section("first", [], ["seg_a"]), section("second", [], ["seg_b", "seg_c"])];
    const transcript = [
      { id: "seg_a", startMs: 0, endMs: 1000, slidePointer: null },
      { id: "seg_b", startMs: 10_000, endMs: 11_000, slidePointer: null },
      { id: "seg_c", startMs: 11_000, endMs: 12_000, slidePointer: null },
    ] as never;
    const snapshots = [snap("snp_later", [], 900), snap("snp_early", [], 500), snap("snp_overlap", ["seg_a", "seg_b", "seg_c"], 0)];
    placeSnapshots(sections, [...snapshots, snapshots[0]!], transcript);
    expect(sections[0]!.blocks.filter((block) => block.type === "image").map((block) => block.snapshotId)).toEqual(["snp_early", "snp_later"]);
    expect(sections[1]!.blocks.filter((block) => block.type === "image").map((block) => block.snapshotId)).toEqual(["snp_overlap"]);
  });
});
