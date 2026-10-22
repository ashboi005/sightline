/**
 * Session recordings — OWNER: TBD (scaffolded by Ashwath; the recorder itself is Sahil's, in the browser).
 *
 * Flow (docs/contracts/recordings.md): create → per segment: reserve (presigned PUT) → browser PUTs bytes straight
 * to storage → complete (server verifies the object) → finish. Playback URLs are presigned on every list.
 */
import {
  RECORDING_SEGMENT_MAX_BYTES,
  type CreateRecordingInput,
  type CreateRecordingSegmentInput,
  type Recording,
  type RecordingSegment,
  type RecordingSegmentUpload,
} from "@sightline/contracts";

import { AppError, notFound } from "../../lib/errors";
import { newId } from "../../lib/ids";
import type { ObjectStorage } from "../../lib/storage";
import type { SessionStore } from "../../shared/ports";

const EXT: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4", "audio/webm": "weba", "audio/mp4": "m4a" };

export const segmentKey = (sessionId: string, recordingId: string, index: number, contentType: string) =>
  `recordings/${sessionId}/${recordingId}/segment-${String(index).padStart(4, "0")}.${EXT[contentType] ?? "bin"}`;

export class RecordingService {
  constructor(private readonly deps: { store: SessionStore; storage: ObjectStorage; urlTtlSeconds: number }) {}

  async create(sessionId: string, input: CreateRecordingInput): Promise<Recording> {
    const session = await this.deps.store.findSession(sessionId);
    if (!session) throw notFound("Session");
    if (session.status !== "LIVE") throw new AppError("CONFLICT", "Recordings can only start while the session is LIVE");
    const recording: Recording = {
      id: newId("rec"),
      sessionId,
      source: input.source,
      status: "RECORDING",
      startedAt: Date.now(),
      endedAt: null,
      durationMs: 0,
      segments: [],
    };
    await this.deps.store.upsertRecording(recording);
    return recording;
  }

  async reserveSegment(sessionId: string, recordingId: string, input: CreateRecordingSegmentInput): Promise<RecordingSegmentUpload> {
    const recording = await this.require(sessionId, recordingId);
    if (recording.status !== "RECORDING") throw new AppError("CONFLICT", "Recording is already finished");
    const existing = recording.segments.find((s) => s.index === input.index);
    if (existing?.status === "UPLOADED") throw new AppError("CONFLICT", `Segment ${input.index} is already uploaded`);

    const segment: RecordingSegment = {
      index: input.index,
      contentType: input.contentType,
      status: "PENDING",
      sizeBytes: input.sizeBytes,
      startMs: input.startMs,
      durationMs: input.durationMs,
      url: null,
    };
    const segments = [...recording.segments.filter((s) => s.index !== input.index), segment].sort((a, b) => a.index - b.index);
    await this.deps.store.upsertRecording({ ...recording, segments });
    const upload = await this.deps.storage.presignUpload(segmentKey(sessionId, recordingId, input.index, input.contentType), {
      contentType: input.contentType,
      expiresIn: this.deps.urlTtlSeconds,
    });
    return { segment, upload };
  }

  async completeSegment(sessionId: string, recordingId: string, index: number): Promise<RecordingSegment> {
    const recording = await this.require(sessionId, recordingId);
    const segment = recording.segments.find((s) => s.index === index);
    if (!segment) throw notFound(`Segment ${index}`);
    const object = await this.deps.storage.stat(segmentKey(sessionId, recordingId, index, segment.contentType));
    if (!object) throw new AppError("CONFLICT", `Segment ${index} has not been uploaded yet`);
    if (object.size > RECORDING_SEGMENT_MAX_BYTES) {
      await this.deps.storage.deleteObject(segmentKey(sessionId, recordingId, index, segment.contentType));
      throw new AppError("VALIDATION_ERROR", "Segment exceeds the size limit");
    }
    const done: RecordingSegment = { ...segment, status: "UPLOADED", sizeBytes: object.size };
    await this.deps.store.upsertRecording({
      ...recording,
      segments: recording.segments.map((s) => (s.index === index ? done : s)),
    });
    return { ...done, url: await this.playbackUrl(sessionId, recordingId, done) };
  }

  async finish(sessionId: string, recordingId: string): Promise<Recording> {
    const recording = await this.require(sessionId, recordingId);
    const uploaded = recording.segments.filter((s) => s.status === "UPLOADED");
    const finished: Recording = {
      ...recording,
      status: uploaded.length > 0 ? "READY" : "FAILED",
      endedAt: recording.endedAt ?? Date.now(),
      durationMs: uploaded.reduce((sum, s) => sum + s.durationMs, 0),
    };
    await this.deps.store.upsertRecording(finished);
    return this.withUrls(finished);
  }

  async list(sessionId: string): Promise<Recording[]> {
    const recordings = await this.deps.store.listRecordings(sessionId);
    return Promise.all(recordings.map((r) => this.withUrls(r)));
  }

  private async require(sessionId: string, recordingId: string) {
    const recording = await this.deps.store.getRecording(sessionId, recordingId);
    if (!recording) throw notFound("Recording");
    return recording;
  }

  private playbackUrl(sessionId: string, recordingId: string, segment: RecordingSegment) {
    return this.deps.storage.presignDownload(segmentKey(sessionId, recordingId, segment.index, segment.contentType), {
      expiresIn: this.deps.urlTtlSeconds,
      contentType: segment.contentType,
    });
  }

  private async withUrls(recording: Recording): Promise<Recording> {
    const segments = await Promise.all(
      recording.segments.map(async (s) => ({
        ...s,
        url: s.status === "UPLOADED" ? await this.playbackUrl(recording.sessionId, recording.id, s) : null,
      })),
    );
    return { ...recording, segments };
  }
}
