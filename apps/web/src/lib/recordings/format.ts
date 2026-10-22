// Picks a MediaRecorder format the browser can produce and the recording contract accepts.

type ContentType = "video/webm" | "video/mp4" | "audio/webm" | "audio/mp4";

const VIDEO: [string, ContentType][] = [
  ["video/webm;codecs=vp9,opus", "video/webm"],
  ["video/webm;codecs=vp8,opus", "video/webm"],
  ["video/webm", "video/webm"],
  ["video/mp4;codecs=avc1,mp4a", "video/mp4"],
  ["video/mp4", "video/mp4"],
];

const AUDIO: [string, ContentType][] = [
  ["audio/webm;codecs=opus", "audio/webm"],
  ["audio/webm", "audio/webm"],
  ["audio/mp4", "audio/mp4"],
];

/** `mimeType` goes to MediaRecorder; `contentType` to the server. Null when the browser can't record. */
export function pickRecordingFormat(
  isTypeSupported: (mime: string) => boolean,
  hasVideo: boolean,
): { mimeType: string; contentType: ContentType } | null {
  for (const [mimeType, contentType] of hasVideo ? VIDEO : AUDIO) {
    if (isTypeSupported(mimeType)) return { mimeType, contentType };
  }
  return null;
}
