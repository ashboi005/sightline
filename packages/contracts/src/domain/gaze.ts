import { z } from "zod";

import { SegmentId, Timestamp } from "./common";

/**
 * Where the student is looking.
 * SCREEN = laptop. BOARD = physical board/teacher at the front. PERSON = a specific speaker (see targetId).
 * AWAY = somewhere else. UNKNOWN = tracker lost the eyes (blink, no face) — UI should treat it as "no change".
 */
export const GazeZone = z.enum(["SCREEN", "BOARD", "PERSON", "AWAY", "UNKNOWN"]);
export type GazeZone = z.infer<typeof GazeZone>;

/** A person/sound source the student can focus on (Hard-of-Hearing mode). */
export const FocusTarget = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["TEACHER", "PEER", "UNKNOWN"]),
  /** Horizontal angle relative to the student, -90 (left) … +90 (right). */
  azimuthDeg: z.number().min(-180).max(180),
});
export type FocusTarget = z.infer<typeof FocusTarget>;

/** Sent by the web app to the server whenever the zone changes (persisted for notes / P1 markers). */
export const GazeTransition = z.object({
  from: GazeZone,
  to: GazeZone,
  targetId: z.string().nullable(),
  ts: Timestamp,
});
export type GazeTransition = z.infer<typeof GazeTransition>;

/** A period where the student was not looking at the screen. Derived server-side from transitions. */
export const AwayWindow = z.object({
  zone: GazeZone,
  startedAt: Timestamp,
  endedAt: Timestamp,
  missedSegmentIds: z.array(SegmentId),
});
export type AwayWindow = z.infer<typeof AwayWindow>;
