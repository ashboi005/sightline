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
    if (t.to === "UNKNOWN") continue;
    if (!open && AWAY_ZONES.has(t.to)) open = { zone: t.to, startedAt: t.ts };
    else if (open && t.to === "SCREEN") {
      windows.push({ ...open, endedAt: t.ts, missedSegmentIds: [] });
      open = null;
    }
  }
  if (open) windows.push({ ...open, endedAt, missedSegmentIds: [] });

  for (const w of windows) {
    w.missedSegmentIds = segments
      .filter((s) => startedAt + s.endMs >= w.startedAt && startedAt + s.startMs <= w.endedAt)
      .map((s) => s.id);
  }
  return windows;
}
