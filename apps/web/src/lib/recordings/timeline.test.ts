import { describe, expect, test } from "bun:test";
import type { RecordingSegment } from "@sightline/contracts";

import { activeCaptionIndex, coveredRange, formatClock, locate, playableSegments, toLectureMs } from "./timeline";

const seg = (index: number, startMs: number, durationMs: number, extra: Partial<RecordingSegment> = {}): RecordingSegment => ({
  index,
  contentType: "video/webm",
  status: "UPLOADED",
  sizeBytes: 1,
  startMs,
  durationMs,
  url: `blob:${index}`,
  ...extra,
});

// 0–60 s recorded, a gap (recording stopped), then 90–150 s
const segments = playableSegments([seg(1, 90_000, 60_000), seg(0, 0, 60_000), seg(2, 200_000, 10_000, { status: "PENDING", url: null })]);

describe("recording timeline", () => {
  test("only uploaded segments with a URL play, in lecture order", () => {
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
  });

  test("lecture time = segment start + player time", () => {
    expect(toLectureMs(segments[1]!, 12.5)).toBe(102_500);
  });

  test("seeking converts lecture time to the segment's local time", () => {
    expect(locate(segments, 30_000)).toEqual({ index: 0, offsetSeconds: 30, inGap: false });
    expect(locate(segments, 100_000)).toEqual({ index: 1, offsetSeconds: 10, inGap: false });
  });

  test("a time inside a gap lands at the start of the next segment", () => {
    expect(locate(segments, 75_000)).toEqual({ index: 1, offsetSeconds: 0, inGap: true });
  });

  test("past the end clamps to the end of the last segment", () => {
    expect(locate(segments, 500_000)).toEqual({ index: 1, offsetSeconds: 60, inGap: false });
  });

  test("no playable video", () => {
    expect(locate([], 1000)).toBeNull();
    expect(coveredRange([])).toBeNull();
    expect(coveredRange(segments)).toEqual({ startMs: 0, endMs: 150_000 });
  });

  test("active caption is the last one started", () => {
    const captions = [{ startMs: 0 }, { startMs: 5_000 }, { startMs: 9_000 }];
    expect(activeCaptionIndex(captions, 6_000)).toBe(1);
    expect(activeCaptionIndex(captions, 9_000)).toBe(2);
    expect(activeCaptionIndex(captions, -1)).toBe(-1);
  });

  test("clock formatting", () => {
    expect(formatClock(42_000)).toBe("0:42");
    expect(formatClock(725_000)).toBe("12:05");
    expect(formatClock(3_789_000)).toBe("1:03:09");
  });
});
