import type { MicCapture } from "@sightline/live-client";
import { loadVoiceDecoder } from "../esp-camera/voice/voice-decoder";
import type { VoiceDecoder } from "../esp-camera/voice/voice-decoder.types";
import { focusCommandPhrases } from "./commands";

/** Subscribe to the lecture's existing 16 kHz room mic; never open or stop another microphone. */
export async function startSharedVoiceSession(
  mic: MicCapture,
  handler: (text: string) => void,
  signal: AbortSignal,
  onFailure: (failure: unknown) => void,
  onRejected?: () => void,
) {
  signal.throwIfAborted();
  const cancellation = new AbortController();
  const active = AbortSignal.any([signal, cancellation.signal]);
  let decoder: VoiceDecoder | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancellation.abort();
    signal.removeEventListener("abort", stop);
    mic.context.removeEventListener("statechange", changed);
    unsubscribe?.();
    decoder?.stop();
  };
  const fail = (error: unknown) => {
    if (!stopped) {
      stop();
      onFailure(error);
    }
  };
  const changed = () => {
    if (mic.context.state === "closed")
      fail(new Error("Microphone disconnected"));
  };
  signal.addEventListener("abort", stop, { once: true });
  mic.context.addEventListener("statechange", changed);
  try {
    if (mic.context.state === "closed")
      throw new Error("Microphone disconnected");
    decoder = await loadVoiceDecoder(active, fail, focusCommandPhrases);
    active.throwIfAborted();
    decoder.listen(
      16000,
      (text) => {
        if (!stopped) handler(text);
      },
      fail,
      onRejected,
    );
    const current = decoder;
    unsubscribe = mic.subscribe((samples) => {
      if (!stopped) current.accept(samples, 16000);
    });
    return { stop };
  } catch (error) {
    stop();
    throw error;
  }
}
