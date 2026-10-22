"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { connectGazeBridge } from "@/lib/realtime/gaze-bridge";
import type { Socket, SocketStatus } from "@/lib/realtime/socket";
import type { AccessibilityMode } from "@/types";
import type {
  CalibrationProgress,
  CalibrationResult,
  DeviceStatus,
  FocusTarget,
  GazeBridgeCommand,
  GazeBridgeMessage,
  GazeTransition,
  GazeZone,
} from "@/types/realtime";

/**
 * Connects to the local eye-tracker bridge and tracks where the student is looking.
 *
 * `zone` ignores UNKNOWN (blinks), so it only changes on real zone changes, and each change is reported once
 * through `onTransition`. Forward those to the session socket for the notes:
 *
 *   const gaze = useGazeBridge({
 *     onTransition: (transition) => live.send({ type: "gaze.transition", transition, ts: Date.now() }),
 *   });
 *   const paused = gaze.isAway; // Deaf mode: freeze caption scroll and bookmark while true
 *
 * High-rate streams (`gaze.scene` for look-to-hear, `gaze.point`) aren't kept in state; read them in `onMessage`.
 */
export function useGazeBridge(
  options: {
    enabled?: boolean;
    onTransition?: (transition: GazeTransition) => void;
    onMessage?: (message: GazeBridgeMessage) => void;
  } = {},
) {
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<SocketStatus>("CLOSED");
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [zone, setZone] = useState<GazeZone>("SCREEN");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targets, setTargets] = useState<FocusTarget[]>([]);
  const [calibration, setCalibration] = useState<CalibrationProgress | CalibrationResult | null>(null);
  const socketRef = useRef<Socket<GazeBridgeCommand> | null>(null);
  const zoneRef = useRef<GazeZone>("SCREEN");

  const handleMessage = useEffectEvent((message: GazeBridgeMessage) => {
    options.onMessage?.(message);
    switch (message.type) {
      case "device.status":
        return setDevice(message);
      case "gaze.targets":
        return setTargets(message.targets);
      case "calibration.progress":
      case "calibration.result":
        return setCalibration(message);
      case "gaze.zone": {
        if (message.zone === "UNKNOWN" || message.zone === zoneRef.current) return; // blink or heartbeat
        const transition: GazeTransition = {
          from: zoneRef.current,
          to: message.zone,
          targetId: message.targetId,
          ts: message.ts,
        };
        zoneRef.current = message.zone;
        setZone(message.zone);
        setTargetId(message.targetId);
        options.onTransition?.(transition);
        return;
      }
      case "error":
        return console.warn("[gaze] bridge error", message.code, message.message);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = connectGazeBridge({ onMessage: (m) => handleMessage(m), onStatus: setStatus });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [enabled]);

  const send = (command: GazeBridgeCommand) => socketRef.current?.send(command);

  return {
    status,
    device,
    zone,
    targetId,
    /** Looking at the board, a person or away: captions should pause (Deaf mode). */
    isAway: zone !== "SCREEN",
    targets,
    /** The latest calibration step, or the result once it finishes. */
    calibration,
    send,
    setMode: (mode: AccessibilityMode) => send({ type: "mode.set", mode }),
    startCalibration: () => {
      setCalibration(null);
      send({ type: "calibration.start" });
    },
    confirmCalibration: (step: number) => send({ type: "calibration.confirm", step }),
    cancelCalibration: () => send({ type: "calibration.cancel" }),
  };
}
