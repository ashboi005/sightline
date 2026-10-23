"use client";

import { useEffect, useRef } from "react";

import { useSceneTracking } from "@/providers/scene/context";

import {
  readSceneSourcePreferences,
  writeSceneSourcePreferences,
} from "@/features/scene-tracking/features/eye-tracking/use-camera-source-preferences";

export function readSceneCameraId(): string | null {
  const selected = readSceneSourcePreferences();
  return selected.kind === "usb" ? selected.deviceId || null : null;
}
export function saveSceneCameraId(id: string | null) {
  writeSceneSourcePreferences({
    ...readSceneSourcePreferences(),
    kind: "usb",
    deviceId: id ?? "",
  });
}

/**
 * The lecture's scene camera: a stream plus an offscreen <video> that snapshots, voice focus and recording read
 * from. Visible previews attach their own <video> to `stream`, so closing a preview never stops the camera.
 */
export function useSceneCamera() {
  return useSceneTracking().media;
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
