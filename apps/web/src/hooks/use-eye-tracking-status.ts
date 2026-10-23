"use client";

import { useEffect, useReducer } from "react";

import type { StatusKind } from "@/components/clay/clay";
import { useGaze } from "@/providers/gaze-provider";
import { useSceneTracking } from "@/providers/scene/context";

/** Report the calibrated camera used by person selection before considering the optional external bridge. */
export function useEyeTrackingStatus(): {
  source: "camera" | "bridge" | "none";
  status: string;
  kind: StatusKind;
  detail: string;
} {
  const { tracker, state } = useSceneTracking();
  const gaze = useGaze();
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!tracker.source) return;
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, [tracker.source]);

  if (
    tracker.source ||
    tracker.connection === "connecting" ||
    tracker.connection === "reconnecting"
  ) {
    const source = "camera" as const;
    if (
      tracker.connection === "connecting" ||
      tracker.connection === "reconnecting"
    ) {
      return {
        source,
        status:
          tracker.connection === "reconnecting"
            ? "Reconnecting eye camera"
            : "Connecting eye camera",
        kind: "working",
        detail:
          "Waiting for the camera stream. Your saved calibration is unchanged.",
      };
    }
    const age = tracker.frame
      ? performance.now() - tracker.frame.timestamp
      : Infinity;
    if (
      tracker.connection !== "live" ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 1000
    ) {
      return {
        source,
        status: "Waiting for eye frames",
        kind: "attention",
        detail:
          tracker.error ||
          "The eye stream has paused. Gaze selection resumes with fresh frames.",
      };
    }
    if (!tracker.settings.locked || !state.calibration) {
      return {
        source,
        status: "Eye camera live",
        kind: "attention",
        detail:
          "The camera is running. Lock the eye model and load or complete a calibration in Setup to select with gaze.",
      };
    }
    if (!tracker.frame?.gaze) {
      return {
        source,
        status: "Reacquiring pupil",
        kind: "working",
        detail:
          "The calibrated eye camera is running. Waiting for a clear pupil measurement.",
      };
    }
    return {
      source,
      status: "Eye tracking live",
      kind: "ready",
      detail:
        "Your eye camera and loaded calibration are active. Person selection uses the POV scene camera.",
    };
  }

  if (gaze.status === "OPEN" && gaze.device?.tracker === "CONNECTED") {
    return {
      source: "bridge",
      status: gaze.device.calibrated
        ? "Connected and calibrated"
        : "Not calibrated",
      kind: gaze.device.calibrated ? "ready" : "attention",
      detail: "External eye-tracker bridge connected.",
    };
  }
  return {
    source: "none",
    status: "Eye camera not connected",
    kind: "idle",
    detail:
      "Connect your eye camera in Setup for gaze selection. You can also select a face by clicking it in Voice focus.",
  };
}
