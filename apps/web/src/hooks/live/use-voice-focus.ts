"use client";

import { SpeakerHealth } from "@sightline/contracts";
import {
  startLookToHear,
  type LookToHearState,
  type MicCapture,
} from "@sightline/live-client";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { LocalVoiceController } from "@/features/esp-camera/voice/local-voice";
import { hasFreshFrame } from "@/features/esp-camera/tracking/selection";
import { VoiceFocusGaze } from "@/features/voice-focus/calibrated-input";
import { parseFocusCommand } from "@/features/voice-focus/commands";
import { startSharedVoiceSession } from "@/features/voice-focus/shared-voice";
import { SPEAKER_HEALTH_URL, SPEAKER_SERVICE_URL } from "@/lib/config";
import { useSceneTracking } from "@/providers/scene/context";
import { useSpeakerOutput } from "./use-speaker-output";
import type { SceneCamera } from "@/features/scene-tracking/features/scene-eye-tracking/scene-camera";

type LookToHear = Awaited<ReturnType<typeof startLookToHear>>;
export type VoiceFocusState = LookToHearState & { playbackDelay: number };

function cameraKey(camera: SceneCamera) {
  const snapshot = camera.getSnapshot();
  return JSON.stringify([
    snapshot.source?.key,
    snapshot.frame?.generation,
    snapshot.transform,
  ]);
}

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

/** Calibrated POV gaze + explicit voice selection; only the existing speaker service processes audio. */
export function useVoiceFocus() {
  const runtime = useSceneTracking();
  const latest = useRef(runtime);
  latest.current = runtime;
  const session = useRef<LookToHear | null>(null);
  const mic = useRef<MicCapture | null>(null);
  const run = useRef(0);
  const pending = useRef(false);
  const initializing = useRef<AbortController | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [state, setState] = useState<VoiceFocusState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [input] = useState(() => new VoiceFocusGaze());
  const [cursor, setCursor] = useState<ReturnType<
    VoiceFocusGaze["read"]
  > | null>(null);
  const [videoOffsetMs, setVideoOffsetMs] = useState(0);
  const [verifiedSource, setVerifiedSource] = useState<string | null>(null);
  const syncVerified =
    verifiedSource !== null &&
    verifiedSource === cameraKey(runtime.scene.camera);
  const setSyncVerified = useCallback((verified: boolean) => {
    setVerifiedSource(verified ? cameraKey(latest.current.scene.camera) : null);
  }, []);
  const [commands] = useState(
    () =>
      new LocalVoiceController((...args) => {
        if (!mic.current)
          return Promise.reject(new Error("Start voice focus first."));
        return startSharedVoiceSession(mic.current, ...args);
      }),
  );
  const voice = useSyncExternalStore(
    commands.subscribe,
    commands.getSnapshot,
    commands.getSnapshot,
  );

  const readGaze = useCallback(() => {
    const current = latest.current;
    return input.read(
      current.state.session.getSnapshot(),
      current.scene.camera.getSnapshot(),
      current.tracker.settings.locked && current.tracker.connection === "live",
      performance.now(),
    );
  }, [input]);

  const stop = useCallback(async () => {
    run.current++;
    initializing.current?.abort();
    initializing.current = null;
    pending.current = false;
    cleanup.current?.();
    cleanup.current = null;
    commands.stop();
    mic.current = null;
    const previous = session.current;
    session.current = null;
    setState(null);
    setCursor(null);
    setStarting(false);
    await previous?.stop();
  }, [commands]);

  const outputLost = useCallback(() => {
    void stop();
    setError(
      "The selected speaker disconnected. Choose an output and restart voice focus.",
    );
  }, [stop]);
  const changeOutput = useCallback(
    async (id: string) => {
      try {
        await session.current?.setOutputDevice(id);
      } catch (error) {
        await stop();
        setError(
          error instanceof Error ? error.message : "Audio output failed.",
        );
        throw error;
      }
    },
    [stop],
  );
  const output = useSpeakerOutput(changeOutput, outputLost, state !== null);

  const start = useCallback(
    async (capture: MicCapture, sceneVideo: HTMLVideoElement) => {
      if (session.current || pending.current) return;
      if (
        !syncVerified ||
        verifiedSource !== cameraKey(latest.current.scene.camera) ||
        !Number.isFinite(videoOffsetMs) ||
        Math.abs(videoOffsetMs) > 500
      ) {
        setSyncVerified(false);
        setError(
          "Check the POV video and microphone timing before starting voice focus.",
        );
        return;
      }
      const camera = latest.current.scene.camera;
      const source = camera.getSnapshot().source;
      if (!source || !hasFreshFrame(camera.getSnapshot(), performance.now())) {
        setError("Connect the POV scene camera and wait for a fresh frame.");
        return;
      }
      const sourceKey = () => cameraKey(camera);
      const initialSource = sourceKey();
      const request = ++run.current;
      const startup = new AbortController();
      initializing.current = startup;
      pending.current = true;
      mic.current = capture;
      setStarting(true);
      setError(null);
      setFeedback("");
      try {
        const next = await startLookToHear({
          mic: capture,
          sceneVideo,
          speakerUrl: SPEAKER_SERVICE_URL,
          source: source.kind,
          selectionMode: "confirmed",
          outputDeviceId: output.deviceId,
          signal: startup.signal,
          videoOffsetMs,
          readFrame: () => {
            const snapshot = camera.getSnapshot();
            const frame = snapshot.frame;
            if (
              sourceKey() !== initialSource ||
              !frame ||
              !hasFreshFrame(snapshot, performance.now())
            )
              return null;
            return {
              key: `${frame.generation}:${frame.id}`,
              image: camera.rawCanvas,
              width: frame.width,
              height: frame.height,
              capturedAt: frame.timestamp,
            };
          },
          onState: (next) => {
            if (request === run.current) setState(next);
          },
        });
        if (request !== run.current) {
          await next.stop();
          return;
        }
        session.current = next;
        const changed = () => {
          if (
            sourceKey() !== initialSource ||
            capture.context.state === "closed"
          ) {
            void stop();
            setSyncVerified(false);
            setError(
              "The POV camera or microphone changed. Check its timing and restart voice focus.",
            );
          }
        };
        const unsubscribe = camera.subscribe(changed);
        capture.context.addEventListener("statechange", changed);
        cleanup.current = () => {
          unsubscribe();
          capture.context.removeEventListener("statechange", changed);
        };
        changed();
      } catch (error) {
        if (request === run.current) {
          setState(null);
          mic.current = null;
          setError(
            error instanceof Error
              ? error.message
              : "Voice focus couldn't start.",
          );
        }
      } finally {
        if (initializing.current === startup) initializing.current = null;
        if (request === run.current) {
          pending.current = false;
          setStarting(false);
        }
      }
    },
    [
      output.deviceId,
      syncVerified,
      verifiedSource,
      videoOffsetMs,
      stop,
      setSyncVerified,
    ],
  );

  const selectAtGaze = useCallback(() => {
    const gaze = readGaze();
    setCursor(gaze);
    const result = session.current?.selectAtGaze(gaze.gaze, performance.now());
    setFeedback(
      gaze.gaze
        ? (result?.message ?? "Start voice focus first.")
        : gaze.message,
    );
  }, [readGaze]);
  const select = useCallback((targetId: string | null) => {
    const result = session.current?.select(targetId);
    if (result) setFeedback(result.message);
  }, []);
  const toggleVoice = useCallback(() => {
    if (
      commands.getSnapshot().status === "listening" ||
      commands.getSnapshot().status === "starting"
    ) {
      commands.stop();
      return;
    }
    if (!session.current) return;
    void commands.start((text) => {
      switch (parseFocusCommand(text)) {
        case "select":
          selectAtGaze();
          break;
        case "clear":
          select(null);
          break;
        case "voice-stop":
          commands.stop();
          break;
      }
    });
  }, [commands, selectAtGaze, select]);

  const active = state !== null;
  useEffect(() => {
    if (!active) return;
    const update = () => setCursor(readGaze());
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [active, readGaze]);
  useEffect(() => {
    commands.mount();
    return () => {
      void stop();
      commands.dispose();
    };
  }, [commands, stop]);

  return {
    state,
    error,
    starting,
    active,
    start,
    stop,
    select,
    selectAtGaze,
    voice,
    toggleVoice,
    cursor,
    feedback,
    output,
    videoOffsetMs,
    syncVerified,
    setVideoOffsetMs: (offset: number) => {
      setVideoOffsetMs(offset);
      setSyncVerified(false);
    },
    setSyncVerified,
  };
}
