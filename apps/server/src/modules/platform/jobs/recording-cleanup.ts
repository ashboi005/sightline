import type { Recording } from "@sightline/contracts";
import { segmentKey } from "../../recordings/recording-service";
import type { JobPayload } from "./types";

export function recordingCleanup(recordings: Recording[], delayMs: number): JobPayload {
  const recordingKeys = recordings.flatMap((recording) => recording.segments.map((segment) => segmentKey(recording.sessionId, recording.id, segment.index, segment.contentType)));
  return { recordingKeys: [...new Set(recordingKeys)], ...(recordingKeys.length && delayMs > 0 ? { recordingCleanupAfter: Date.now() + delayMs } : {}) };
}
