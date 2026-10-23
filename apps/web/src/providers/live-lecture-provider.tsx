"use client";

import type { AccessibilityMode, GazeTransition, SessionServerMessage } from "@sightline/contracts";
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
import { ACTIVE_LECTURE_KEY } from "@/lib/account-state";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { LIVE, pauseReducer } from "@/lib/live/gaze-pause";
import { speakUtterance } from "@/lib/live/speak";

import { useGaze } from "./gaze-provider";


const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_LECTURE_KEY);
  } catch {
    return null;
  }
};
const writeActive = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_LECTURE_KEY, id);
    else localStorage.removeItem(ACTIVE_LECTURE_KEY);
  } catch {
    // storage blocked: the lecture is still tracked until reload
  }
};

export type BeginOptions = {
  /** Turn on the scene camera: board snapshots, voice focus and the recording come from it. */
  sceneCamera: boolean;
  /** Record the lecture from the scene camera (turns it on). */
  record: boolean;
  /** Watch the student's face through the webcam to pause captions and catch board looks. */
  webcam: boolean;
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

  const live = useSessionSocket(activeId, { onMessage: (m: SessionServerMessage) => handleServerMessage(m) });

  const session = activeSession.data ?? live.session;

  /** What the server tells this lecture that needs a visible response. */
  function handleServerMessage(m: SessionServerMessage) {
    snapshots.current?.onSessionMessage(m);
    switch (m.type) {
      case "snapshot.request":
        // The teacher referred to something visual, but there's no scene camera to capture it.
        if (!snapshots.current) {
          toast.info("The teacher pointed at the board", {
            description: "Turn on the scene camera to save the board into your notes.",
            action: { label: "Turn on", onClick: () => void scene.start() },
          });
        }
        return;
      case "snapshot.captured":
        if (m.snapshot.description === null) {
          toast.success("Board snapshot saved to your notes", {
            description: m.snapshot.reason || undefined,
            icon: <img src={assetUrl(m.snapshot.imageUrl)} alt="" className="size-10 rounded-md object-cover" />,
          });
        }
        return;
      case "sign.utterance":
        // Speak the student's own sentences once, even when they were signed in another tab.
        if (m.utterance.source === "SELF") speakUtterance(m.utterance);
        return;
      case "error":
        if (m.code === "STT_ERROR") {
          toast.error("Captions stopped", {
            id: "stt-error",
            description: "The speech-to-text service isn't responding. The lecture keeps running; captions resume when it's back.",
          });
        }
        return;
    }
  }
  const mode: AccessibilityMode = session?.mode ?? "DEAF";

  /** Stops everything this device runs for the lecture: recording (waiting for the last upload) first. */
  const teardown = async () => {
    if (recorder.state.status === "recording") await recorder.stop();
    await voice.stop();
    snapshots.current?.stop();
    await mic.stop();
    scene.stop();
    gaze.attention.stop();
  };

  // Ended or deleted somewhere else (another tab or device, or it was never live here): save what this device was
  // recording, release the devices, and stop following it.
  const releasing = useRef(false);
  const releaseEndedLecture = useEffectEvent(async () => {
    if (releasing.current) return;
    releasing.current = true;
    try {
      const wasRecording = recorder.state.status === "recording";
      await teardown();
      setActiveId(null);
      if (wasRecording) toast.info("The lecture ended on another device, so the recording was saved.");
    } finally {
      releasing.current = false;
    }
  });
  const goneElsewhere = Boolean(activeId) && !ending && ((activeSession.data && activeSession.data.status !== "LIVE") || activeSession.isError);
  useEffect(() => {
    if (goneElsewhere) void releaseEndedLecture();
  }, [goneElsewhere]);

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
      const video = options.sceneCamera || options.record ? await scene.start() : null;
      const webcamFailure = options.webcam ? await gaze.attention.start() : null;
      if (webcamFailure) toast.error("Webcam tracking didn't start", { description: `${webcamFailure} Captions still work.` });
      if (options.record) {
        await recorder.start({
          sessionId,
          sessionStartedAt: started.startedAt ?? Date.now(),
          source: "SCENE_CAMERA",
          sceneStream: (video?.srcObject as MediaStream | null) ?? null,
        });
      }
      return started;
    },
    [needsMicForCaptions, startSession, setActiveId, mic, scene, recorder, gaze.attention],
  );

  /** Stops recording (waiting for the last upload), voice focus, snapshots and devices, then ends the lecture. */
  const end = async () => {
    if (!activeId) return;
    setEnding(true);
    try {
      await teardown();
      await endSession.mutateAsync(activeId);
      setActiveId(null);
    } catch (error) {
      toast.error(`The lecture couldn't be ended: ${errorMessage(error)}`);
      throw error;
    } finally {
      setEnding(false);
    }
  };

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
