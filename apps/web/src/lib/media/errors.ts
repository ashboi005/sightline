/** Turns a getUserMedia / getDisplayMedia failure into what happened and what to do. */
export function describeMediaError(error: unknown, device: "microphone" | "camera" | "screen"): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return device === "screen"
      ? "Screen sharing was cancelled. Choose a screen or window to record it."
      : `Sightline isn't allowed to use your ${device}. Allow it in your browser's site settings, then try again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${device} was found. Plug one in or choose another, then try again.`;
  if (name === "NotReadableError") return `Your ${device} is busy in another app. Close that app, then try again.`;
  if (typeof navigator !== "undefined" && !navigator.mediaDevices) return "This browser can't use cameras or microphones here. Use Chrome, Edge or Safari over localhost or HTTPS.";
  return error instanceof Error ? error.message : `Couldn't start the ${device}.`;
}
