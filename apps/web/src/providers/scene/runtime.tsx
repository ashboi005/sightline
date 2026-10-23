"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTracker } from "@/features/scene-tracking/features/eye-tracking/use-tracker";
import type { EyeModel } from "@/features/scene-tracking/features/eye-tracking/eye-tracking.types";
import { useSceneCamera } from "@/features/scene-tracking/features/scene-eye-tracking/use-scene-camera";
import {
  stableSceneSetupKey,
  useSceneSession,
} from "@/features/scene-tracking/features/scene-eye-tracking/use-scene-session";
import { useHandTracker } from "@/features/scene-tracking/features/scene-eye-tracking/use-hand-tracker";
import { useMarkerTracker } from "@/features/scene-tracking/features/scene-eye-tracking/use-marker-tracker";
import { useCameraIdentity } from "@/features/scene-tracking/features/tracking-calibration/use-camera-identity";
import { useSceneProfiles } from "@/hooks/use-scene-profiles";
import { SceneContext } from "./context";
import { useSceneMedia } from "./media";

function useRuntime(userId: string) {
  const tracker = useTracker();
  const scene = useSceneCamera();
  const pathname = usePathname();
  const inSetup = pathname === "/setup";
  const [step, setStep] = useState(0);
  const [regionComplete, setRegionComplete] = useState(false);
  const [revision, setRevision] = useState(0);
  const cache = useRef<{
    revision: number;
    model: EyeModel | null;
    key: string | null;
  }>({ revision: -1, model: null, key: null });
  if (cache.current.revision !== revision)
    cache.current = { revision, model: null, key: null };
  if (tracker.settings.locked && tracker.frame?.model?.ready)
    cache.current.model = tracker.frame.model;
  const setupKey =
    stableSceneSetupKey(tracker, scene.camera, cache.current.model) ??
    cache.current.key;
  cache.current.key = setupKey;
  const state = useSceneSession(
    tracker,
    scene.camera,
    JSON.stringify([revision, setupKey]),
  );
  const fingerprint = useCameraIdentity(setupKey ?? "");
  const setup = useMemo(
    () => ({
      trackerFormat: tracker.settings.format,
      fingerprint: fingerprint || undefined,
      orientation: { eye: tracker.transform, scene: scene.transform },
    }),
    [tracker.settings.format, tracker.transform, scene.transform, fingerprint],
  );
  const ready =
    !!tracker.source &&
    tracker.settings.locked &&
    !!fingerprint &&
    scene.connection === "live" &&
    !!scene.frame;
  const profiles = useSceneProfiles(userId, state.session, state, setup, ready);
  const detecting = inSetup && step >= 3 && !!scene.source;
  const hands = useHandTracker(
    scene.camera,
    detecting && state.method !== "marker",
  );
  const markers = useMarkerTracker(
    scene.camera,
    detecting && state.method === "marker",
  );
  useEffect(() => {
    if (state.method === "marker" && markers.marker)
      state.session.observeReference(
        { ...markers.marker, kind: "marker" },
        performance.now(),
      );
    else if (state.method !== "marker" && hands.hand)
      state.session.observeHand(hands.hand, performance.now());
  }, [hands.hand, markers.marker, state.method, state.session]);
  useEffect(() => {
    if (!inSetup) state.session.cancelCapture();
  }, [inSetup, state.session]);
  const invalidateEye = useCallback(() => {
    setRevision((value) => value + 1);
    setRegionComplete(false);
  }, []);
  const media = useSceneMedia(scene.camera, tracker.source?.deviceId);
  return {
    tracker,
    scene,
    state,
    profiles,
    ready,
    hands,
    markers,
    step,
    setStep,
    regionComplete,
    setRegionComplete,
    invalidateEye,
    media,
  };
}
export type SceneRuntime = ReturnType<typeof useRuntime>;
export default function SceneRuntimeProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const runtime = useRuntime(userId);
  return <SceneContext value={runtime}>{children}</SceneContext>;
}
