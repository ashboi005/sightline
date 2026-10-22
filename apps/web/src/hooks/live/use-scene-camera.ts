"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeMediaError } from "@/lib/media/errors";

const DEVICE_KEY = "sightline.scene-camera";

/** The camera chosen as the scene camera (the eye tracker's world camera, or any webcam). Remembered per browser. */
export function readSceneCameraId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function saveSceneCameraId(id: string | null) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // storage blocked: the choice lasts until reload
  }
}

/**
 * The lecture's scene camera: a stream plus an offscreen <video> that snapshots, voice focus and recording read
 * from. Visible previews attach their own <video> to `stream`, so closing a preview never stops the camera.
 */
export function useSceneCamera() {
  const [camera, setCamera] = useState<{ stream: MediaStream; video: HTMLVideoElement } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    videoRef.current = null;
    setCamera(null);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return videoRef.current;
    try {
      const deviceId = readSceneCameraId();
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { ideal: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      await video.play().catch(() => {});
      s.getVideoTracks()[0]?.addEventListener("ended", stop);
      streamRef.current = s;
      videoRef.current = video;
      setCamera({ stream: s, video });
      setError(null);
      return video;
    } catch (e) {
      setError(describeMediaError(e, "camera"));
      return null;
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { stream: camera?.stream ?? null, video: camera?.video ?? null, error, start, stop };
}

/** Attach a MediaStream to a visible <video> preview. */
export function useStreamPreview(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return ref;
}
