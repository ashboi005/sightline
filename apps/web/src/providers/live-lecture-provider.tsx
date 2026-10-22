"use client";

import type { AccessibilityMode, GazeTransition, RecordingSource, SessionServerMessage } from "@sightline/contracts";
import { startSmartSnapshots, streamMicToSession } from "@sightline/live-client";
import { createContext, use, useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import { useMicrophone } from "@/hooks/live/use-microphone";
import { useLectureRecorder } from "@/hooks/live/use-lecture-recorder";
import { useSceneCamera } from "@/hooks/live/use-scene-camera";
import { useVoiceFocus } from "@/hooks/live/use-voice-focus";
import { useHealth } from "@/hooks/use-lecture-data";
import { useSessionSocket } from "@/hooks/use-session-socket";
import { useEndSession, useSession, useStartSession, useUpdateSession } from "@/hooks/use-sessions";
import { api, errorMessage } from "@/lib/api";
import { LIVE, pauseReducer } from "@/lib/live/gaze-pause";

import { useGaze } from "./gaze-provider";

const ACTIVE_KEY = "sightline.active-lecture";

const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};
const writeActive = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage blocked: the lecture is still tracked until reload
  }
};

export type BeginOptions = {
  /** Record the lecture from this source, or don't record. */
  record: RecordingSource | null;
  /** Turn on the scene camera (needed for voice focus, board snapshots and scene recording). */
  sceneCamera: boolean;
};

type SmartSnapshots = ReturnType<typeof startSmartSnapshots>;

/**
 * Owns the one running lecture for the whole workspace, so moving between pages never interrupts it:
 * the session socket and captions, gaze pausing, the mic, the scene camera, recording, voice focus and board
 * snapshots. Only "End lecture" stops it. The active lecture id survives a reload; devices need a click again.
 */
function useLiveLectureRuntime() {
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const gaze = useGaze();
  const health = useHealth();

  const activeSession = useSession(activeId);
  const startSession = useStartSession();
  const endSession = useEndSession();
  const updateSession = useUpdateSession(activeId ?? "");

  const mic = useMicrophone();
  const scene = useSceneCamera();
  const recorder = useLectureRecorder();
  const voice = useVoiceFocus();
  const snapshots = useRef<SmartSnapshots | null>(null);
  const [pause, dispatchPause] = useReducer(pauseReducer, LIVE);

  const setActiveId = useCallback((id: string | null) => {
    writeActive(id);
    setActiveIdState(id);
  }, []);

  useEffect(() => setActiveIdState(readActive()), []);

  const live = useSessionSocket(activeId, {
    onMessage: (m: SessionServerMessage) => {
      snapshots.current?.onSessionMessage(m);
      if (m.type === "snapshot.captured" && m.snapshot.description === null) {
        toast.success("Board snapshot saved to your notes", { description: m.snapshot.reason || undefined });
      }
    },
  });

  const session = activeSession.data ?? live.session;
  const mode: AccessibilityMode = session?.mode ?? "DEAF";

  // A remembered lecture that has since ended (or was deleted) is no longer active.
  useEffect(() => {
    if (!activeId || ending) return;
    if (activeSession.data && activeSession.data.status !== "LIVE") setActiveId(null);
    if (activeSession.isError) setActiveId(null);
  }, [activeId, ending, activeSession.data, activeSession.isError, setActiveId]);

  // A new lecture starts live, with nothing missed.
  useEffect(() => dispatchPause({ type: "resume" }), [activeId]);

  // Gaze: forward every real zone change to the server (notes use them); in Deaf mode, pause/catch-up captions.
  const lastSeq = live.captions.segments.at(-1)?.seq ?? -1;
  const handleTransition = useEffectEvent((transition: GazeTransition) => {
    live.socket?.send({ type: "gaze.transition", transition, ts: Date.now() });
    if (mode === "DEAF") dispatchPause({ type: "gaze", zone: transition.to, lastSeq, ts: transition.ts });
  });
  const { onTransition, onMessage } = gaze;
  useEffect(() => {
    if (!activeId) return;
    const offTransition = onTransition((t) => handleTransition(t));
    const offMessage = onMessage((m) => {
      if (m.type === "gaze.zone") snapshots.current?.onGazeZone(m.zone);
    });
    return () => {
      offTransition();
      offMessage();
    };
  }, [activeId, onTransition, onMessage]);

  // Keep the bridge's mode in step with the lecture (audio focus only runs in hard-of-hearing mode).
  const syncBridgeMode = useEffectEvent(() => gaze.setMode(mode));
  useEffect(() => {
    if (session?.status === "LIVE") syncBridgeMode();
  }, [session?.status, mode]);

  // Mic → captions, unless the server is replaying a recorded lecture. Re-announce after a reconnect.
  const socketOpen = live.status === "OPEN";
  useEffect(() => {
    if (!mic.mic || !live.socket || live.isReplay || !socketOpen || !live.session) return;
    const stream = streamMicToSession(live.socket, mic.mic);
    return () => stream.stop();
  }, [mic.mic, live.socket, live.isReplay, socketOpen, live.session]);

  // Board snapshots from the scene camera: speech cues, board dwell, visual change, and "Save board".
  useEffect(() => {
    if (!activeId || !scene.video || session?.status !== "LIVE") return;
    const id = activeId;
    const s = startSmartSnapshots({
      video: scene.video,
      upload: (image, fields) => api.uploadSnapshot(id, image, fields),
    });
    snapshots.current = s;
    return () => {
      s.stop();
      snapshots.current = null;
    };
  }, [activeId, scene.video, session?.status]);

  const needsMicForCaptions = health.data ? !health.data.mocks.speech : true;

  /** Start a DRAFT lecture (or reattach to a LIVE one) and turn on what it needs. Call from a click. */
  const begin = useCallback(
    async (sessionId: string, options: BeginOptions) => {
      const current = await api.getSession(sessionId);
      const started = current.status === "DRAFT" ? await startSession.mutateAsync(sessionId) : current;
      setActiveId(sessionId);
      if (needsMicForCaptions || started.mode === "HARD_OF_HEARING") await mic.start();
      const video = options.sceneCamera ? await scene.start() : null;
      if (options.record) {
        await recorder.start({
          sessionId,
          sessionStartedAt: started.startedAt ?? Date.now(),
          source: options.record,
          sceneStream: (video?.srcObject as MediaStream | null) ?? null,
        });
      }
      return started;
    },
    [needsMicForCaptions, startSession, setActiveId, mic, scene, recorder],
  );

  /** Stops recording (waiting for the last upload), voice focus, snapshots and devices, then ends the lecture. */
  const end = useCallback(async () => {
    if (!activeId) return;
    setEnding(true);
    try {
      if (recorder.state.status === "recording") await recorder.stop();
      await voice.stop();
      snapshots.current?.stop();
      await mic.stop();
      scene.stop();
      await endSession.mutateAsync(activeId);
      setActiveId(null);
    } catch (error) {
      toast.error(`The lecture couldn't be ended: ${errorMessage(error)}`);
      throw error;
    } finally {
      setEnding(false);
    }
  }, [activeId, recorder, voice, mic, scene, endSession, setActiveId]);

  /** Switch Deaf ↔ hard-of-hearing during the lecture. */
  const setMode = useCallback(
    async (next: AccessibilityMode) => {
      if (!activeId) return;
      await updateSession.mutateAsync({ mode: next });
      gaze.setMode(next);
      if (next === "DEAF") {
        await voice.stop();
      } else {
        dispatchPause({ type: "resume" });
        await mic.start();
      }
    },
    [activeId, updateSession, gaze, voice, mic],
  );

  /** Voice focus needs the lecture mic and the scene camera; turns on whichever is missing. */
  const startVoiceFocus = useCallback(async () => {
    const m = await mic.start();
    const video = scene.video ?? (await scene.start());
    if (!m || !video) return;
    await voice.start(m, video);
  }, [mic, scene, voice]);

  return {
    activeId,
    session,
    mode,
    live,
    ending,
    pause,
    pauseCaptions: () => dispatchPause({ type: "pause", lastSeq }),
    resumeLive: () => dispatchPause({ type: "resume" }),
    needsMicForCaptions,
    mic,
    scene,
    recorder,
    voice: { ...voice, start: startVoiceFocus },
    saveBoard: () => snapshots.current?.capture("MANUAL", "You saved the board"),
    canSaveBoard: Boolean(scene.video && session?.status === "LIVE"),
    begin,
    end,
    setMode,
    /** Follow a LIVE lecture opened from a link or after a reload. */
    attach: setActiveId,
  };
}

export type LiveLecture = ReturnType<typeof useLiveLectureRuntime>;

const LiveLectureContext = createContext<LiveLecture | null>(null);

export function LiveLectureProvider({ children }: { children: React.ReactNode }) {
  return <LiveLectureContext value={useLiveLectureRuntime()}>{children}</LiveLectureContext>;
}

export function useLiveLecture() {
  const value = use(LiveLectureContext);
  if (!value) throw new Error("useLiveLecture must be used inside <LiveLectureProvider>");
  return value;
}
