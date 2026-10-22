import { z } from "zod";

import { OffsetMs, SessionId, Timestamp } from "./common";

/**
 * Session recordings: what the student saw (scene camera / eye-tracker camera) + heard, for later review next to the
 * transcript. Recorded in the browser in self-contained segments (~5 min each) uploaded straight to storage via
 * presigned URLs. Docs: docs/contracts/recordings.md.
 */
export const RecordingSource = z.enum(["SCENE_CAMERA", "WEBCAM", "SCREEN"]);
export type RecordingSource = z.infer<typeof RecordingSource>;

export const RecordingStatus = z.enum(["RECORDING", "READY", "FAILED"]);
export type RecordingStatus = z.infer<typeof RecordingStatus>;

export const RECORDING_CONTENT_TYPES = ["video/webm", "video/mp4", "audio/webm", "audio/mp4"] as const;
export const RecordingContentType = z.enum(RECORDING_CONTENT_TYPES);
export const RECORDING_SEGMENT_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB per segment

export const RecordingId = z.string().startsWith("rec_");

export const RecordingSegment = z.object({
  index: z.number().int().nonnegative(),
  contentType: RecordingContentType,
  status: z.enum(["PENDING", "UPLOADED"]),
  sizeBytes: z.number().int().nonnegative(),
  /** Offset of the segment's first frame from the session start (lines the video up with captions). */
  startMs: OffsetMs,
  durationMs: z.number().int().nonnegative(),
  /** Presigned playback URL (fresh on every GET; expires ~1 h). Null until uploaded. */
  url: z.string().nullable(),
});
export type RecordingSegment = z.infer<typeof RecordingSegment>;

export const Recording = z.object({
  id: RecordingId,
  sessionId: SessionId,
  source: RecordingSource,
  status: RecordingStatus,
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
  /** Sum of uploaded segment durations. */
  durationMs: z.number().int().nonnegative(),
  segments: z.array(RecordingSegment),
});
export type Recording = z.infer<typeof Recording>;

export const CreateRecordingInput = z.object({
  source: RecordingSource.default("SCENE_CAMERA"),
  contentType: RecordingContentType.default("video/webm"),
});
export type CreateRecordingInput = z.infer<typeof CreateRecordingInput>;

export const CreateRecordingSegmentInput = z.object({
  index: z.number().int().nonnegative(),
  contentType: RecordingContentType,
  sizeBytes: z.number().int().positive().max(RECORDING_SEGMENT_MAX_BYTES),
  startMs: OffsetMs,
  durationMs: z.number().int().nonnegative(),
});
export type CreateRecordingSegmentInput = z.infer<typeof CreateRecordingSegmentInput>;

/** Where to PUT the segment bytes. Send exactly `headers`; then call completeRecordingSegment. */
export const PresignedUpload = z.object({
  url: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: Timestamp,
});
export type PresignedUpload = z.infer<typeof PresignedUpload>;

export const RecordingSegmentUpload = z.object({ segment: RecordingSegment, upload: PresignedUpload });
export type RecordingSegmentUpload = z.infer<typeof RecordingSegmentUpload>;
