"use client";

import { SpeakerHealth } from "@sightline/contracts";
import { startLookToHear, type LookToHearState, type MicCapture } from "@sightline/live-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { GAZE_BRIDGE_URL, SPEAKER_HEALTH_URL, SPEAKER_SERVICE_URL } from "@/lib/config";

type LookToHear = Awaited<ReturnType<typeof startLookToHear>>;
export type VoiceFocusState = LookToHearState & { playbackDelay: number };

/** Is the local voice-focus (speaker) service running, and is its model ready? */
export function useSpeakerHealth(enabled = true) {
  return useQuery({
    queryKey: ["speaker-health"],
    queryFn: async () => {
      const res = await fetch(SPEAKER_HEALTH_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`The voice service answered ${res.status}`);
      return SpeakerHealth.parse(await res.json());
    },
    enabled,
    retry: 0,
    refetchInterval: 10_000,
  });
}

/**
 * Look-to-hear: the speaker service isolates the voice of the face the student looks at (gaze-driven, with a
 * click-to-select fallback) and plays it into their earphones / hearing aids. Needs the lecture mic and scene camera.
 */
export function useVoiceFocus() {
  const session = useRef<LookToHear | null>(null);
  const [state, setState] = useState<VoiceFocusState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (mic: MicCapture, sceneVideo: HTMLVideoElement) => {
    if (session.current) return;
    setStarting(true);
    setError(null);
    try {
      session.current = await startLookToHear({
        mic,
        sceneVideo,
        speakerUrl: SPEAKER_SERVICE_URL,
        gazeBridgeUrl: GAZE_BRIDGE_URL,
        onState: setState,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice focus couldn't start.");
    } finally {
      setStarting(false);
    }
  }, []);

  const stop = useCallback(async () => {
    const s = session.current;
    session.current = null;
    setState(null);
    await s?.stop();
  }, []);

  useEffect(() => () => void session.current?.stop(), []);

  return {
    state,
    error,
    starting,
    active: state !== null,
    start,
    stop,
    /** Click-to-select a face, or null to stop listening to anyone. */
    select: (targetId: string | null) => session.current?.select(targetId),
  };
}
