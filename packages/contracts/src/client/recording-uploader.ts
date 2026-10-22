import type { RecordingSegment } from "../domain/recordings";
import type { SightlineApi } from "./http";

/**
 * Uploads a recording segment by segment (Sahil): you produce self-contained video blobs (e.g. restart MediaRecorder
 * every ~5 min), this does reserve → presigned PUT → complete for each, in order, with retries.
 *
 *   const rec = await createRecordingUploader(api, sessionId, { contentType: "video/webm" });
 *   recorder.ondataavailable/onstop → rec.addSegment(blob, { startMs, durationMs })
 *   await rec.finish();
 */
export async function createRecordingUploader(
  api: SightlineApi,
  sessionId: string,
  options: { source?: "SCENE_CAMERA" | "WEBCAM" | "SCREEN"; contentType?: "video/webm" | "video/mp4"; retries?: number } = {},
) {
  const contentType = options.contentType ?? "video/webm";
  const recording = await api.createRecording(sessionId, { source: options.source ?? "SCENE_CAMERA", contentType });
  let index = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const uploaded: RecordingSegment[] = [];
  const failures: unknown[] = [];

  async function uploadOne(blob: Blob, timing: { startMs: number; durationMs: number }, n: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        const { upload } = await api.createRecordingSegment(sessionId, recording.id, {
          index: n,
          contentType,
          sizeBytes: blob.size,
          startMs: Math.max(0, Math.round(timing.startMs)),
          durationMs: Math.max(0, Math.round(timing.durationMs)),
        });
        await api.uploadToPresigned(upload, blob);
        uploaded.push(await api.completeRecordingSegment(sessionId, recording.id, n));
        return;
      } catch (error) {
        if (attempt >= (options.retries ?? 2)) {
          failures.push(error);
          return;
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  return {
    recording,
    /** Queue one finished segment (uploads run one at a time, in order). */
    addSegment(blob: Blob, timing: { startMs: number; durationMs: number }) {
      if (blob.size === 0) return queue;
      const n = index++;
      queue = queue.then(() => uploadOne(blob, timing, n));
      return queue;
    },
    /** Wait for queued uploads, then mark the recording READY (FAILED if nothing uploaded). */
    async finish() {
      await queue;
      return { recording: await api.finishRecording(sessionId, recording.id), uploaded, failures };
    },
  };
}

export type RecordingUploader = Awaited<ReturnType<typeof createRecordingUploader>>;
