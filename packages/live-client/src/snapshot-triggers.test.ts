import { describe, expect, it } from "bun:test";

import { BoardDwellTrigger, frameDifference, SnapshotGate, VisualChangeDetector } from "./snapshot-triggers";

describe("BoardDwellTrigger", () => {
  it("fires once per board visit after the dwell, ignoring blinks", () => {
    const t = new BoardDwellTrigger(4000);
    expect(t.update("BOARD", 0)).toBe(false);
    expect(t.update("UNKNOWN", 1000)).toBe(false); // blink doesn't reset
    expect(t.update("BOARD", 3900)).toBe(false);
    expect(t.update("BOARD", 4100)).toBe(true);
    expect(t.update("BOARD", 9000)).toBe(false); // same visit
    expect(t.update("SCREEN", 9100)).toBe(false);
    expect(t.update("BOARD", 10_000)).toBe(false);
    expect(t.update("BOARD", 14_100)).toBe(true); // new visit
  });
});

describe("VisualChangeDetector", () => {
  const frame = (fill: number, marked = 0) => {
    const f = new Uint8Array(32 * 18).fill(fill);
    for (let i = 0; i < marked; i++) f[i] = 255; // "chalk" on the board
    return f;
  };

  it("fires when new content appears and settles, not while it is still changing", () => {
    const d = new VisualChangeDetector({ changeThreshold: 0.06, stableThreshold: 0.015, stableMs: 1500 });
    expect(d.feed(frame(40), 0)).toBe(false); // reference
    expect(d.feed(frame(40), 500)).toBe(false);
    // Teacher drawing: frames keep changing.
    for (let t = 1000, marked = 40; t < 4000; t += 500, marked += 40) expect(d.feed(frame(40, marked), t)).toBe(false);
    // Drawing finished (240 marked pixels ≈ 0.09 vs reference), stays still for 1.5 s.
    let fired = false;
    for (let t = 4000; t <= 6000; t += 500) fired ||= d.feed(frame(40, 240), t);
    expect(fired).toBe(true);
    // Unchanged board afterwards never fires again.
    for (let t = 6500; t <= 10_000; t += 500) expect(d.feed(frame(40, 240), t)).toBe(false);
  });

  it("ignores small lighting noise", () => {
    const d = new VisualChangeDetector();
    d.feed(frame(40), 0);
    for (let t = 500; t <= 5000; t += 500) expect(d.feed(frame(41), t)).toBe(false);
  });

  it("frameDifference is 0..1", () => {
    expect(frameDifference(frame(0), frame(0))).toBe(0);
    expect(frameDifference(frame(0), frame(255))).toBe(1);
  });
});

describe("SnapshotGate", () => {
  it("enforces the cooldown", () => {
    const g = new SnapshotGate(15_000);
    expect(g.allow(0)).toBe(true);
    expect(g.allow(10_000)).toBe(false);
    expect(g.allow(15_001)).toBe(true);
  });
});
