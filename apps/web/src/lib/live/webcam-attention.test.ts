import { describe, expect, test } from "bun:test";

import { ATTENTION, AttentionTracker, classifyAttention, headAngles, type HeadAngles } from "./webcam-attention";

/** A column-major transform whose forward axis (third column) points along `forward`, scaled by 2. */
const matrixFacing = (forward: [number, number, number]) => {
  const m = new Array<number>(16).fill(0);
  [m[8], m[9], m[10]] = forward.map((v) => v * 2);
  m[14] = -40;
  m[15] = 1;
  return m;
};
const rad = (deg: number) => (deg * Math.PI) / 180;

const screen: HeadAngles = { yaw: 0, pitch: -8 };

/** Feeds `angles` every 100 ms from `from` to `to` (inclusive) and returns every zone change. */
function run(tracker: AttentionTracker, angles: HeadAngles | null, from: number, to: number) {
  const changes: string[] = [];
  for (let t = from; t <= to; t += 100) {
    const changed = tracker.update(angles, t);
    if (changed) changes.push(`${t}:${changed}`);
  }
  return changes;
}

/** A tracker that has learned `screen` as the baseline by t = 1500. */
function calibrated() {
  const tracker = new AttentionTracker();
  run(tracker, screen, 0, ATTENTION.baselineMs);
  return tracker;
}

describe("headAngles", () => {
  test("facing the camera is 0° yaw and pitch, whatever the matrix scale", () => {
    const angles = headAngles(matrixFacing([0, 0, 1]))!;
    expect(angles.yaw).toBeCloseTo(0);
    expect(angles.pitch).toBeCloseTo(0);
  });

  test("a forward axis tilted up and to the side reads as positive pitch and yaw", () => {
    const angles = headAngles(matrixFacing([Math.sin(rad(20)) * Math.cos(rad(15)), Math.sin(rad(15)), Math.cos(rad(20)) * Math.cos(rad(15))]))!;
    expect(angles.yaw).toBeCloseTo(20);
    expect(angles.pitch).toBeCloseTo(15);
  });

  test("malformed matrices give no angles", () => {
    expect(headAngles([1, 2, 3])).toBeNull();
    expect(headAngles(new Array(16).fill(0))).toBeNull();
  });
});

describe("classifyAttention", () => {
  test("judges against the student's own screen pose", () => {
    expect(classifyAttention({ yaw: 4, pitch: -6 }, screen)).toBe("SCREEN");
    expect(classifyAttention({ yaw: 0, pitch: -8 + ATTENTION.lookUpDeg + 1 }, screen)).toBe("BOARD");
    expect(classifyAttention({ yaw: 0, pitch: -8 - ATTENTION.lookDownDeg - 1 }, screen)).toBe("AWAY");
    expect(classifyAttention({ yaw: -(ATTENTION.turnDeg + 1), pitch: -8 }, screen)).toBe("AWAY");
    expect(classifyAttention(null, screen)).toBe("AWAY");
  });
});

describe("AttentionTracker", () => {
  test("stays on the screen while it learns the baseline, even if the first poses look up", () => {
    const tracker = new AttentionTracker();
    expect(run(tracker, { yaw: 0, pitch: 20 }, 0, 1400)).toEqual([]);
    expect(tracker.calibrated).toBe(false);
    run(tracker, { yaw: 0, pitch: 20 }, 1500, 1500);
    expect(tracker.calibrated).toBe(true);
    expect(tracker.zone).toBe("SCREEN");
  });

  test("looking up at the board switches to BOARD once it holds, then back to SCREEN", () => {
    const tracker = calibrated();
    const up = { yaw: 0, pitch: screen.pitch + 18 };
    expect(run(tracker, up, 2000, 2400)).toEqual([]);
    expect(run(tracker, up, 2500, 3000)).toEqual(["2500:BOARD"]);
    expect(run(tracker, screen, 3100, 3700)).toEqual(["3600:SCREEN"]);
  });

  test("a quick glance up never leaves the screen", () => {
    const tracker = calibrated();
    run(tracker, { yaw: 0, pitch: screen.pitch + 18 }, 2000, 2300);
    expect(run(tracker, screen, 2400, 4000)).toEqual([]);
    expect(tracker.zone).toBe("SCREEN");
  });

  test("a dropped frame or two is ignored; a face gone for longer is AWAY", () => {
    const tracker = calibrated();
    expect(run(tracker, null, 2000, 2700)).toEqual([]);
    expect(run(tracker, screen, 2800, 2800)).toEqual([]);
    // Last face at 2800: AWAY is seen from 3600 (no face for 800 ms) and committed after holding 500 ms.
    expect(run(tracker, null, 2900, 4300)).toEqual(["4100:AWAY"]);
  });

  test("recenter learns a new screen pose", () => {
    const tracker = calibrated();
    tracker.recenter();
    const slouched = { yaw: 10, pitch: -20 };
    run(tracker, slouched, 5000, 6500);
    expect(tracker.calibrated).toBe(true);
    expect(run(tracker, slouched, 6600, 8000)).toEqual([]);
    expect(tracker.zone).toBe("SCREEN");
  });
});
