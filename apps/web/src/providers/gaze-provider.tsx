"use client";

import type { GazeBridgeMessage, GazeTransition, GazeZone } from "@sightline/contracts";
import { createContext, use, useCallback, useEffect, useRef } from "react";

import { useWebcamAttention } from "@/hooks/live/use-webcam-attention";
import { useGazeBridge } from "@/hooks/use-gaze-bridge";

type Listener<T> = (value: T) => void;

type GazeContextValue = ReturnType<typeof useGazeBridge> & {
  /** Every bridge message (zones incl. the 1 Hz heartbeat, scene gaze…). Returns unsubscribe. */
  onMessage: (listener: Listener<GazeBridgeMessage>) => () => void;
  /** Real zone changes only (blinks ignored). Returns unsubscribe. */
  onTransition: (listener: Listener<GazeTransition>) => () => void;
  /** Webcam head tracking: while active, its zone replaces the eye tracker's. */
  attention: ReturnType<typeof useWebcamAttention>;
};

const GazeContext = createContext<GazeContextValue | null>(null);

/**
 * One gaze source for the whole workspace: Setup, the lecture and the sidebar status share it. Zones come from the
 * eye-tracker bridge, or from the webcam while webcam attention runs; listeners can't tell the difference.
 */
export function GazeProvider({ children }: { children: React.ReactNode }) {
  const messageListeners = useRef(new Set<Listener<GazeBridgeMessage>>());
  const transitionListeners = useRef(new Set<Listener<GazeTransition>>());
  const webcamActive = useRef(false);
  const webcamZone = useRef<GazeZone>("SCREEN");

  const gaze = useGazeBridge({
    onMessage: (m) => {
      if (webcamActive.current && m.type === "gaze.zone") return;
      messageListeners.current.forEach((l) => l(m));
    },
    onTransition: (t) => {
      if (!webcamActive.current) transitionListeners.current.forEach((l) => l(t));
    },
  });

  const attention = useWebcamAttention({
    onZone: (zone, changed) => {
      const ts = Date.now();
      const message: GazeBridgeMessage = { type: "gaze.zone", zone, targetId: null, confidence: 1, ts };
      messageListeners.current.forEach((l) => l(message));
      if (!changed) return;
      const transition: GazeTransition = { from: webcamZone.current, to: zone, targetId: null, ts };
      webcamZone.current = zone;
      transitionListeners.current.forEach((l) => l(transition));
    },
  });
  useEffect(() => {
    webcamActive.current = attention.active;
    if (!attention.active) webcamZone.current = "SCREEN";
  }, [attention.active]);

  const onMessage = useCallback((listener: Listener<GazeBridgeMessage>) => {
    messageListeners.current.add(listener);
    return () => void messageListeners.current.delete(listener);
  }, []);
  const onTransition = useCallback((listener: Listener<GazeTransition>) => {
    transitionListeners.current.add(listener);
    return () => void transitionListeners.current.delete(listener);
  }, []);

  const zone = attention.active ? attention.zone : gaze.zone;
  return (
    <GazeContext value={{ ...gaze, zone, isAway: zone !== "SCREEN", targetId: attention.active ? null : gaze.targetId, onMessage, onTransition, attention }}>
      {children}
    </GazeContext>
  );
}

export function useGaze() {
  const value = use(GazeContext);
  if (!value) throw new Error("useGaze must be used inside <GazeProvider>");
  return value;
}
