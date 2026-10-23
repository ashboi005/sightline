"use client";

import type { GazeZone } from "@sightline/contracts";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { describeMediaError } from "@/lib/media/errors";
import { AttentionTracker, headAngles } from "@/lib/live/webcam-attention";

const CAMERA_KEY = "sightline.attention-webcam";
/** ~8 fps is plenty for head pose and leaves the laptop free for captions. */
const FRAME_MS = 125;

export function readAttentionCameraId(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY) || null;
  } catch {
    return null;
  }
}
export function saveAttentionCameraId(id: string | null) {
  try {
    if (id) localStorage.setItem(CAMERA_KEY, id);
    else localStorage.removeItem(CAMERA_KEY);
  } catch {
    // storage blocked: the default camera is used
  }
}

// One face model for the page, loaded on first use (WASM and model come from `prepare:vision`).
let landmarker: Promise<FaceLandmarker> | null = null;
function loadLandmarker() {
  landmarker ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks("/vision-runtime/wasm");
    const create = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
    return create("GPU").catch(() => create("CPU"));
  })().catch((error) => {
    landmarker = null;
    throw error;
  });
  return landmarker;
}

export type AttentionStatus = "off" | "starting" | "learning" | "tracking" | "error";

/**
 * Watches the student's face through the laptop webcam and reports where they're looking: SCREEN, BOARD (head
 * raised) or AWAY. The first moments learn their "looking at the screen" pose; `recenter` learns it again.
 * Frames never leave the browser. `onZone` gets every judged frame, with `changed` set on a real zone change.
 */
export function useWebcamAttention(options: { onZone: (zone: GazeZone, changed: boolean) => void }) {
  const [status, setStatus] = useState<AttentionStatus>("off");
  const [zone, setZone] = useState<GazeZone>("SCREEN");
  const [error, setError] = useState<string | null>(null);
  const run = useRef<{ stream: MediaStream; timer: ReturnType<typeof setTimeout> | undefined } | null>(null);
  const tracker = useRef(new AttentionTracker());

  const report = useEffectEvent((next: GazeZone, changed: boolean) => options.onZone(next, changed));

  const stop = useCallback(() => {
    const current = run.current;
    run.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    current.stream.getTracks().forEach((t) => t.stop());
    const wasAway = tracker.current.zone !== "SCREEN";
    tracker.current.recenter();
    setZone("SCREEN");
    setStatus("off");
    if (wasAway) report("SCREEN", true);
  }, []);

  /** Turns the webcam on. Resolves to null once tracking runs, or to why it couldn't start. */
  const start = useCallback(async (): Promise<string | null> => {
    if (run.current) return null;
    setStatus("starting");
    setError(null);
    let stream: MediaStream | null = null;
    try {
      const deviceId = readAttentionCameraId();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }), width: 640, height: 480 },
      });
      const model = await loadLandmarker();
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      const current = { stream, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      run.current = current;
      tracker.current.recenter();
      setZone("SCREEN");
      setStatus("learning");

      let lastFrameTime = -1;
      const tick = () => {
        if (run.current !== current) return;
        if (video.readyState >= 2 && video.currentTime !== lastFrameTime) {
          lastFrameTime = video.currentTime;
          const result = model.detectForVideo(video, performance.now());
          const matrix = result.facialTransformationMatrixes?.[0]?.data;
          const t = tracker.current;
          const changed = t.update(matrix ? headAngles(matrix) : null, Date.now());
          if (t.calibrated) {
            setStatus("tracking");
            if (changed) setZone(changed);
            report(t.zone, changed !== null);
          }
        }
        current.timer = setTimeout(tick, FRAME_MS);
      };
      tick();
      return null;
    } catch (cause) {
      stream?.getTracks().forEach((t) => t.stop());
      const message =
        cause instanceof DOMException ? describeMediaError(cause, "camera") : "The face tracker couldn't load. Reload the page to try again.";
      setError(message);
      setStatus("error");
      return message;
    }
  }, []);

  /** "I'm looking at the screen now": learn the screen pose again. */
  const recenter = useCallback(() => {
    if (!run.current) return;
    const wasAway = tracker.current.zone !== "SCREEN";
    tracker.current.recenter();
    setZone("SCREEN");
    setStatus("learning");
    if (wasAway) report("SCREEN", true);
  }, []);

  useEffect(() => stop, [stop]);

  return { status, zone, error, active: status === "learning" || status === "tracking", start, stop, recenter };
}
