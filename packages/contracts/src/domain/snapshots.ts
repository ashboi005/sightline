import { z } from "zod";

import { OffsetMs, SegmentId, SessionId, Timestamp } from "./common";

/**
 * Why a board/scene snapshot was taken.
 * SPEECH_CUE    — the teacher said something visual ("look at this diagram", "board pe dekho").
 * BOARD_DWELL   — the student kept looking at the board (gaze) for a while.
 * VISUAL_CHANGE — the board changed (new drawing/writing) and then settled.
 * POINTING      — reserved: teacher pointing gesture detected in the scene frame.
 * MANUAL        — the student pressed the snapshot button.
 */
export const SnapshotTrigger = z.enum(["SPEECH_CUE", "BOARD_DWELL", "VISUAL_CHANGE", "POINTING", "MANUAL"]);
export type SnapshotTrigger = z.infer<typeof SnapshotTrigger>;

export const SnapshotId = z.string().startsWith("snp_");

export const Snapshot = z.object({
  id: SnapshotId,
  sessionId: SessionId,
  imageUrl: z.string(),
  trigger: SnapshotTrigger,
  /** Human-readable reason, e.g. Teacher: "let me draw an example on the board". */
  reason: z.string(),
  capturedAt: Timestamp,
  /** Offset from session start — places the image in the transcript/notes timeline. */
  atMs: OffsetMs,
  /** Captions spoken around the capture (context for the notes section). */
  segmentIds: z.array(SegmentId),
  /** One-line description from the vision model; null until described (or if no vision model). */
  description: z.string().nullable(),
});
export type Snapshot = z.infer<typeof Snapshot>;

/** Multipart fields that accompany the image `file` on POST /api/sessions/:id/snapshots. */
export const CreateSnapshotFields = z.object({
  trigger: SnapshotTrigger,
  reason: z.string().max(300).default(""),
  /** Epoch ms when the frame was grabbed (defaults to upload time). */
  capturedAt: z.coerce.number().int().nonnegative().optional(),
});
export type CreateSnapshotFields = z.infer<typeof CreateSnapshotFields>;

export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SNAPSHOT_ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"] as const;
