import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneCamera } from "@/features/scene-tracking/features/scene-eye-tracking/scene-camera";
import { readSceneSourcePreferences } from "@/features/scene-tracking/features/eye-tracking/use-camera-source-preferences";
import { waitForSceneFrame } from "./wait-for-frame";

type Media = { stream: MediaStream; video: HTMLVideoElement };
/** One oriented scene stream, with startup resolved only after frames and playback are ready. */
export function useSceneMedia(camera: SceneCamera, excludedDeviceId?: string) {
  const current = useRef<Media | null>(null);
  const attaching = useRef<Promise<HTMLVideoElement | null> | null>(null);
  const starting = useRef<Promise<HTMLVideoElement | null> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clear = useCallback(() => {
    const previous = current.current;
    current.current = null;
    previous?.stream.getTracks().forEach((track) => track.stop());
    if (previous) {
      previous.video.pause();
      previous.video.srcObject = null;
    }
    setMedia(null);
  }, []);
  const attach = useCallback((): Promise<HTMLVideoElement | null> => {
    if (attaching.current) return attaching.current;
    if (current.current) return Promise.resolve(current.current.video);
    const pending = (async () => {
      if (!camera.latest || camera.getSnapshot().connection !== "live")
        return null;
      let next: Media | null = null;
      try {
        const stream = camera.rawCanvas.captureStream(24);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        next = { stream, video };
        current.current = next;
        await video.play();
        if (current.current !== next) return null;
        setMedia(next);
        setError(null);
        return video;
      } catch (cause) {
        if (current.current === next) {
          clear();
          setError(
            cause instanceof Error
              ? cause.message
              : "The scene preview could not start.",
          );
        }
        return null;
      }
    })();
    attaching.current = pending;
    void pending.finally(() => {
      if (attaching.current === pending) attaching.current = null;
    });
    return pending;
  }, [camera, clear]);
  useEffect(() => {
    const unsubscribe = camera.subscribe(() => {
      if (!camera.getSnapshot().source && current.current) clear();
    });
    return () => {
      controller.current?.abort();
      unsubscribe();
      clear();
    };
  }, [camera, clear]);
  const start = useCallback((): Promise<HTMLVideoElement | null> => {
    if (starting.current) return starting.current;
    const abort = new AbortController();
    controller.current = abort;
    const pending = (async () => {
      try {
        setError(null);
        if (!camera.getSnapshot().source) {
          const selected = readSceneSourcePreferences();
          if (selected.kind === "network")
            await camera.startNetworkStream(selected.url);
          else await camera.startCamera(selected.deviceId, excludedDeviceId);
        }
        if (abort.signal.aborted) return null;
        await waitForSceneFrame(camera, abort.signal);
        const video = await attach();
        return abort.signal.aborted ? null : video;
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "The scene camera could not start.",
          );
        return null;
      }
    })();
    starting.current = pending;
    void pending.finally(() => {
      if (starting.current === pending) starting.current = null;
    });
    return pending;
  }, [attach, camera, excludedDeviceId]);
  const stop = useCallback(() => {
    controller.current?.abort();
    camera.stop();
    clear();
  }, [camera, clear]);
  return {
    stream: media?.stream ?? null,
    video: media?.video ?? null,
    error: error || camera.getSnapshot().error || null,
    start,
    stop,
  };
}
