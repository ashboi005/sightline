"use client";

import type { GazeBridgeMessage, GazeTransition } from "@sightline/contracts";
import { createContext, use, useCallback, useRef } from "react";

import { useGazeBridge } from "@/hooks/use-gaze-bridge";

type Listener<T> = (value: T) => void;

type GazeContextValue = ReturnType<typeof useGazeBridge> & {
  /** Every bridge message (zones incl. the 1 Hz heartbeat, scene gaze…). Returns unsubscribe. */
  onMessage: (listener: Listener<GazeBridgeMessage>) => () => void;
  /** Real zone changes only (blinks ignored). Returns unsubscribe. */
  onTransition: (listener: Listener<GazeTransition>) => () => void;
};

const GazeContext = createContext<GazeContextValue | null>(null);

/** One gaze-bridge connection for the whole workspace: Setup, the lecture and the sidebar status share it. */
export function GazeProvider({ children }: { children: React.ReactNode }) {
  const messageListeners = useRef(new Set<Listener<GazeBridgeMessage>>());
  const transitionListeners = useRef(new Set<Listener<GazeTransition>>());

  const gaze = useGazeBridge({
    onMessage: (m) => messageListeners.current.forEach((l) => l(m)),
    onTransition: (t) => transitionListeners.current.forEach((l) => l(t)),
  });

  const onMessage = useCallback((listener: Listener<GazeBridgeMessage>) => {
    messageListeners.current.add(listener);
    return () => void messageListeners.current.delete(listener);
  }, []);
  const onTransition = useCallback((listener: Listener<GazeTransition>) => {
    transitionListeners.current.add(listener);
    return () => void transitionListeners.current.delete(listener);
  }, []);

  return <GazeContext value={{ ...gaze, onMessage, onTransition }}>{children}</GazeContext>;
}

export function useGaze() {
  const value = use(GazeContext);
  if (!value) throw new Error("useGaze must be used inside <GazeProvider>");
  return value;
}
