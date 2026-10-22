"use client";

import { startMicCapture, type MicCapture } from "@sightline/live-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeMediaError } from "@/lib/media/errors";

/**
 * The lecture's one microphone (16 kHz, shared by captions and voice focus). Start it from a user action.
 * Stopping it here never touches other pages' devices.
 */
export function useMicrophone() {
  const micRef = useRef<MicCapture | null>(null);
  const pending = useRef<Promise<MicCapture | null> | null>(null);
  const [mic, setMic] = useState<MicCapture | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (micRef.current) return micRef.current;
    pending.current ??= startMicCapture()
      .then((m) => {
        micRef.current = m;
        setMic(m);
        setError(null);
        return m;
      })
      .catch((e: unknown) => {
        setError(describeMediaError(e, "microphone"));
        return null;
      })
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, []);

  const stop = useCallback(async () => {
    const m = micRef.current;
    micRef.current = null;
    setMic(null);
    await m?.stop();
  }, []);

  useEffect(() => () => void micRef.current?.stop(), []);

  return { mic, error, start, stop };
}
