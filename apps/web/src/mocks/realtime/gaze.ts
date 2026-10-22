import type { SocketHandlers } from "@/lib/realtime/socket";
import type { AccessibilityMode } from "@/types";
import type { DeviceStatus, FocusTarget, GazeBridgeCommand, GazeBridgeMessage, GazeZone } from "@/types/realtime";

import { createMockSocket } from "./mock-socket";

const TARGETS: FocusTarget[] = [
  { id: "teacher", label: "Teacher", kind: "TEACHER", azimuthDeg: 0 },
  { id: "peer_left", label: "Classmate (left)", kind: "PEER", azimuthDeg: -45 },
];

// Where the student looks, on a loop: mostly the screen, a look at the board, a blink, a glance at a classmate.
const TIMELINE: { zone: GazeZone; targetId: string | null; ms: number }[] = [
  { zone: "SCREEN", targetId: null, ms: 14_000 },
  { zone: "BOARD", targetId: "teacher", ms: 7_000 },
  { zone: "SCREEN", targetId: null, ms: 9_000 },
  { zone: "UNKNOWN", targetId: null, ms: 300 },
  { zone: "SCREEN", targetId: null, ms: 8_000 },
  { zone: "PERSON", targetId: "peer_left", ms: 4_000 },
];

// Nine on-screen dots, then one "look at the board" step.
const CALIBRATION = [
  ...[0.1, 0.5, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x) => ({ x, y }))),
  null,
];

/** Fake eye tracker: device status, zone changes with a 1 Hz heartbeat, calibration and mode switching. */
export function mockGazeBridge(handlers: SocketHandlers<GazeBridgeMessage>) {
  return createMockSocket<GazeBridgeMessage, GazeBridgeCommand>(handlers, ({ emit, after, every }) => {
    let device: DeviceStatus = {
      type: "device.status",
      protocolVersion: "1",
      tracker: "CONNECTED",
      calibrated: false,
      audioFocus: "IDLE",
      mode: "DEAF",
      ts: Date.now(),
    };
    let current = TIMELINE[0]!;
    let calibrating = false;
    let pointsOn = false;
    let pointLoop = false;

    const updateDevice = (patch: Partial<DeviceStatus>) => {
      device = { ...device, ...patch, ts: Date.now() };
      emit(device);
    };
    const emitZone = () =>
      emit({ type: "gaze.zone", zone: current.zone, targetId: current.targetId, confidence: 0.93, ts: Date.now() });

    emit(device);
    emit({ type: "gaze.targets", targets: TARGETS, ts: Date.now() });
    emitZone();

    const step = (index: number) => {
      current = TIMELINE[index % TIMELINE.length]!;
      emitZone();
      after(current.ms, () => step(index + 1));
    };
    after(TIMELINE[0]!.ms, () => step(1));
    every(1000, emitZone);

    const calibrate = (index: number) => {
      if (!calibrating) return;
      if (index >= CALIBRATION.length) {
        calibrating = false;
        emit({ type: "calibration.result", ok: true, quality: 0.91, message: "Calibration looks good", ts: Date.now() });
        return updateDevice({ calibrated: true });
      }
      const target = CALIBRATION[index] ?? null;
      emit({
        type: "calibration.progress",
        step: index,
        totalSteps: CALIBRATION.length,
        instruction: target ? "Look at the dot" : "Now look at the board",
        target,
        ts: Date.now(),
      });
      after(target ? 1200 : 2500, () => calibrate(index + 1));
    };

    return {
      onCommand: (command) => {
        switch (command.type) {
          case "hello":
            return emit(device);
          case "mode.set": {
            const mode: AccessibilityMode = command.mode;
            return updateDevice({ mode, audioFocus: mode === "HARD_OF_HEARING" ? "ACTIVE" : "IDLE" });
          }
          case "calibration.start":
            calibrating = true;
            return calibrate(0);
          case "calibration.cancel":
            calibrating = false;
            return emit({ type: "calibration.result", ok: false, quality: 0, message: "Calibration cancelled", ts: Date.now() });
          case "gaze.point.subscribe":
            pointsOn = command.enabled;
            if (pointsOn && !pointLoop) {
              pointLoop = true;
              every(100, () => {
                if (!pointsOn || current.zone !== "SCREEN") return;
                const s = Date.now() / 1000;
                emit({ type: "gaze.point", x: 0.5 + 0.3 * Math.sin(s), y: 0.5 + 0.2 * Math.cos(s * 0.7), ts: Date.now() });
              });
            }
            return;
          default:
            // calibration.confirm and audio focus lock/unlock: the mock auto-advances and owns no audio.
            return;
        }
      },
    };
  });
}
