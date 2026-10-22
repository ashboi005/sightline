import { describe, expect, test } from "bun:test";

import { pickRecordingFormat } from "./format";

describe("recording format", () => {
  test("Chrome: webm with vp9", () => {
    expect(pickRecordingFormat(() => true, true)).toEqual({ mimeType: "video/webm;codecs=vp9,opus", contentType: "video/webm" });
  });

  test("Safari: mp4 only", () => {
    const safari = (m: string) => m.startsWith("video/mp4") || m.startsWith("audio/mp4");
    expect(pickRecordingFormat(safari, true)?.contentType).toBe("video/mp4");
    expect(pickRecordingFormat(safari, false)?.contentType).toBe("audio/mp4");
  });

  test("audio-only when there's no camera", () => {
    expect(pickRecordingFormat(() => true, false)?.contentType).toBe("audio/webm");
  });

  test("unsupported browser", () => {
    expect(pickRecordingFormat(() => false, true)).toBeNull();
  });
});
