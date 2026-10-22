import { MOCK_MODE } from "@/lib/api";
import { mockSignService } from "@/mocks/realtime/sign";
import type { SignServiceCommand, SignServiceMessage } from "@/types/realtime";

import { createSocket, type SocketHandlers } from "./socket";

const SIGN_SERVICE_URL = process.env.NEXT_PUBLIC_SIGN_SERVICE_URL || "ws://localhost:7788/ws";
export const SIGN_PROTOCOL_VERSION = "1";

/** The sign recogniser: send `stream.start`, then webcam `frame`s; it answers with gloss tokens. */
export function connectSignService(handlers: SocketHandlers<SignServiceMessage>) {
  if (MOCK_MODE) return mockSignService(handlers);
  return createSocket<SignServiceMessage, SignServiceCommand>(SIGN_SERVICE_URL, handlers);
}

/**
 * Grabs frames from a playing <video> (the webcam) as base64 JPEG, unmirrored, at `fps`.
 * Returns a stop function.
 */
export function startWebcamFrames(
  video: HTMLVideoElement,
  options: { fps: number; width: number; height: number },
  onFrame: (base64Jpeg: string) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext("2d");
  const timer = setInterval(() => {
    if (!ctx || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, options.width, options.height);
    onFrame(canvas.toDataURL("image/jpeg", 0.7).slice("data:image/jpeg;base64,".length));
  }, 1000 / options.fps);
  return () => clearInterval(timer);
}
