import type { CaptionSegment, RecordingSegment } from "@sightline/contracts";

// Recordings are self-contained files placed on the lecture's own clock:
//   lecture time (ms) = segment.startMs + player.currentTime × 1000
// Segments may leave gaps (paused recording, failed upload); seeking into a gap lands on the next segment.

export type PlayableSegment = RecordingSegment & { url: string };

/** Uploaded segments with a URL, in lecture order. */
export function playableSegments(segments: RecordingSegment[]): PlayableSegment[] {
  return segments
    .filter((s): s is PlayableSegment => s.status === "UPLOADED" && s.url !== null)
    .sort((a, b) => a.startMs - b.startMs);
}

export function toLectureMs(segment: Pick<RecordingSegment, "startMs">, currentTimeSeconds: number) {
  return segment.startMs + currentTimeSeconds * 1000;
}

/** Which segment plays `lectureMs`, and where inside it. Gaps snap forward; before/after the video clamps. */
export function locate(segments: PlayableSegment[], lectureMs: number): { index: number; offsetSeconds: number; inGap: boolean } | null {
  if (segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const end = s.startMs + s.durationMs;
    if (lectureMs < s.startMs) return { index: i, offsetSeconds: 0, inGap: i > 0 || lectureMs < s.startMs };
    if (lectureMs <= end) return { index: i, offsetSeconds: (lectureMs - s.startMs) / 1000, inGap: false };
  }
  const last = segments.length - 1;
  return { index: last, offsetSeconds: segments[last]!.durationMs / 1000, inGap: false };
}

/** The lecture span the video covers. */
export function coveredRange(segments: PlayableSegment[]) {
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]!;
  return { startMs: segments[0]!.startMs, endMs: last.startMs + last.durationMs };
}

/** The caption being spoken at `lectureMs`: the last one that started at or before it. */
export function activeCaptionIndex(captions: Pick<CaptionSegment, "startMs">[], lectureMs: number) {
  let lo = 0;
  let hi = captions.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (captions[mid]!.startMs <= lectureMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** 0:42 / 12:05 / 1:03:09 */
export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
