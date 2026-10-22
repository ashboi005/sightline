import type { AwayWindow, CaptionSegment, GazeTransition } from "@sightline/contracts";

const AWAY_ZONES = new Set(["BOARD", "AWAY", "PERSON"]);

/**
 * Collapse gaze transitions into "not looking at the screen" windows and attach the caption segments
 * spoken during each window. UNKNOWN (blinks, tracking loss) never opens or closes a window.
 */
export function deriveAwayWindows(
  transitions: GazeTransition[],
  segments: CaptionSegment[],
  startedAt: number,
  endedAt: number,
): AwayWindow[] {
  const windows: AwayWindow[] = [];
  let open: { zone: AwayWindow["zone"]; startedAt: number } | null = null;

  for (const t of [...transitions].sort((a, b) => a.ts - b.ts)) {
    if (t.to === "UNKNOWN" || t.ts > endedAt) continue;
    const boundary = Math.max(startedAt, t.ts);
    if (open && t.to !== open.zone) {
      if (boundary > open.startedAt) windows.push({ ...open, endedAt: boundary, missedSegmentIds: [] });
      open = null;
    }
    if (!open && AWAY_ZONES.has(t.to)) open = { zone: t.to, startedAt: boundary };
  }
  if (open && endedAt > open.startedAt) windows.push({ ...open, endedAt, missedSegmentIds: [] });

  for (const w of windows) {
    w.missedSegmentIds = segments
      .filter((s) => startedAt + s.endMs >= w.startedAt && startedAt + s.startMs <= w.endedAt)
      .map((s) => s.id);
  }
  return windows;
}
