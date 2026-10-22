/**
 * Mock gaze bridge — stands in for the real gaze bridge (eye tracker + audio focus) during UI work.
 * Speaks the exact protocol in @sightline/contracts (protocols/gaze-bridge.ts).
 *
 *   bun run mock:gaze                    (from repo root)
 *   GAZE_BRIDGE_PORT=7777 bun packages/mocks/servers/mock-gaze-bridge.ts
 *
 * Starts in AUTO mode (plays fixtures/gaze.timeline.json on a loop). Keyboard (switches to MANUAL):
 *   s = SCREEN   b = BOARD   p = PERSON (cycles targets)   a = AWAY   u = UNKNOWN
 *   m = back to AUTO          q = quit
 */
import {
  GAZE_BRIDGE_PROTOCOL_VERSION,
  GazeBridgeCommand,
  type AccessibilityMode,
  type GazeBridgeMessage,
  type GazeZone,
} from "@sightline/contracts";
import type { ServerWebSocket } from "bun";

import { fixtures } from "../src/index";

const PORT = Number(process.env.GAZE_BRIDGE_PORT ?? 7777);
const { targets, steps } = fixtures.gaze;

const clients = new Set<ServerWebSocket<unknown>>();

const state = {
  auto: true,
  stepIndex: 0,
  stepEndsAt: Date.now() + (steps[0]?.durationMs ?? 10_000),
  zone: (steps[0]?.zone ?? "SCREEN") as GazeZone,
  targetId: steps[0]?.targetId ?? null,
  mode: "DEAF" as AccessibilityMode,
  calibrated: false,
  focusTargetId: null as string | null,
  focusLocked: false,
  pointSubscribers: new WeakSet<ServerWebSocket<unknown>>(),
  peerCursor: 0,
};

const send = (ws: ServerWebSocket<unknown>, msg: GazeBridgeMessage) => ws.send(JSON.stringify(msg));
const broadcast = (msg: GazeBridgeMessage) => {
  for (const ws of clients) send(ws, msg);
};

const deviceStatus = (): GazeBridgeMessage => ({
  type: "device.status",
  protocolVersion: GAZE_BRIDGE_PROTOCOL_VERSION,
  tracker: "CONNECTED",
  calibrated: state.calibrated,
  audioFocus: state.mode === "HARD_OF_HEARING" ? "ACTIVE" : "IDLE",
  mode: state.mode,
  ts: Date.now(),
});

const zoneMessage = (): GazeBridgeMessage => ({
  type: "gaze.zone",
  zone: state.zone,
  targetId: state.targetId,
  confidence: state.zone === "UNKNOWN" ? 0.2 : 0.93,
  ts: Date.now(),
});

function audioFocusMessage(): GazeBridgeMessage {
  const target = targets.find((t) => t.id === state.focusTargetId) ?? null;
  return {
    type: "audio.focus",
    targetId: target?.id ?? null,
    label: target?.label ?? null,
    locked: state.focusLocked,
    ts: Date.now(),
  };
}

function setZone(zone: GazeZone, targetId: string | null) {
  if (zone === state.zone && targetId === state.targetId) return;
  state.zone = zone;
  state.targetId = targetId;
  broadcast(zoneMessage());
  log(`gaze → ${zone}${targetId ? ` (${targetId})` : ""}`);

  // Hard-of-hearing: the voice you look at becomes the isolated one (unless locked).
  if (state.mode === "HARD_OF_HEARING" && !state.focusLocked && targetId && targetId !== state.focusTargetId) {
    state.focusTargetId = targetId;
    broadcast(audioFocusMessage());
  }
}

// --- auto timeline ---------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  if (state.auto && now >= state.stepEndsAt) {
    state.stepIndex = (state.stepIndex + 1) % steps.length;
    const step = steps[state.stepIndex]!;
    state.stepEndsAt = now + step.durationMs;
    setZone(step.zone, step.targetId);
  }
}, 50);

// --- 1 Hz heartbeat --------------------------------------------------------
setInterval(() => broadcast(zoneMessage()), 1000);

// --- optional gaze points (15 Hz lissajous while on screen) ----------------
setInterval(() => {
  if (state.zone !== "SCREEN") return;
  const t = Date.now() / 1000;
  const msg: GazeBridgeMessage = {
    type: "gaze.point",
    x: 0.5 + 0.35 * Math.sin(t * 0.7),
    y: 0.5 + 0.3 * Math.sin(t * 1.1 + 1),
    ts: Date.now(),
  };
  for (const ws of clients) if (state.pointSubscribers.has(ws)) send(ws, msg);
}, 1000 / 15);

// --- calibration -----------------------------------------------------------
const CALIBRATION_STEPS: { instruction: string; target: { x: number; y: number } | null }[] = [
  { instruction: "Look at the dot in the top-left corner", target: { x: 0.1, y: 0.1 } },
  { instruction: "Look at the dot in the top-right corner", target: { x: 0.9, y: 0.1 } },
  { instruction: "Look at the dot in the bottom-right corner", target: { x: 0.9, y: 0.9 } },
  { instruction: "Look at the dot in the bottom-left corner", target: { x: 0.1, y: 0.9 } },
  { instruction: "Now look up at the board / teacher", target: null },
];
let calibrationTimer: ReturnType<typeof setTimeout> | null = null;
let currentCalibrationStep = -1;

function runCalibrationStep(step: number) {
  if (step >= CALIBRATION_STEPS.length) {
    state.calibrated = true;
    currentCalibrationStep = -1;
    broadcast({ type: "calibration.result", ok: true, quality: 0.91, message: "Calibration complete", ts: Date.now() });
    broadcast(deviceStatus());
    return;
  }
  const s = CALIBRATION_STEPS[step]!;
  currentCalibrationStep = step;
  broadcast({
    type: "calibration.progress",
    step,
    totalSteps: CALIBRATION_STEPS.length,
    instruction: s.instruction,
    target: s.target,
    ts: Date.now(),
  });
  // The real bridge waits for a stable fixation; the mock auto-advances (or on calibration.confirm).
  calibrationTimer = setTimeout(() => runCalibrationStep(step + 1), 1500);
}

// --- server ----------------------------------------------------------------
Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("Sightline mock gaze bridge — connect via WebSocket", { status: 426 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      send(ws, deviceStatus());
      send(ws, { type: "gaze.targets", targets, ts: Date.now() });
      send(ws, zoneMessage());
      if (state.mode === "HARD_OF_HEARING") send(ws, audioFocusMessage());
      log(`client connected (${clients.size})`);
    },
    close(ws) {
      clients.delete(ws);
      log(`client disconnected (${clients.size})`);
    },
    message(ws, raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        send(ws, { type: "error", code: "BAD_JSON", message: "Frames must be JSON", ts: Date.now() });
        return;
      }
      const result = GazeBridgeCommand.safeParse(parsed);
      if (!result.success) {
        send(ws, { type: "error", code: "VALIDATION_ERROR", message: result.error.message, ts: Date.now() });
        return;
      }
      const cmd = result.data;
      log(`← ${cmd.type}`);
      switch (cmd.type) {
        case "hello":
          send(ws, deviceStatus());
          break;
        case "calibration.start":
          if (calibrationTimer) clearTimeout(calibrationTimer);
          state.calibrated = false;
          runCalibrationStep(0);
          break;
        case "calibration.confirm":
          if (cmd.step === currentCalibrationStep) {
            if (calibrationTimer) clearTimeout(calibrationTimer);
            runCalibrationStep(cmd.step + 1);
          }
          break;
        case "calibration.cancel":
          if (calibrationTimer) clearTimeout(calibrationTimer);
          currentCalibrationStep = -1;
          broadcast({ type: "calibration.result", ok: false, quality: 0, message: "Calibration cancelled", ts: Date.now() });
          break;
        case "mode.set":
          state.mode = cmd.mode;
          if (cmd.mode === "HARD_OF_HEARING" && !state.focusTargetId) state.focusTargetId = "teacher";
          broadcast(deviceStatus());
          if (cmd.mode === "HARD_OF_HEARING") broadcast(audioFocusMessage());
          break;
        case "audio.focus.lock":
          state.focusTargetId = cmd.targetId;
          state.focusLocked = true;
          broadcast(audioFocusMessage());
          break;
        case "audio.focus.unlock":
          state.focusLocked = false;
          broadcast(audioFocusMessage());
          break;
        case "gaze.point.subscribe":
          if (cmd.enabled) state.pointSubscribers.add(ws);
          else state.pointSubscribers.delete(ws);
          break;
      }
    },
  },
});

// --- keyboard control ------------------------------------------------------
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf) => {
    const key = buf.toString();
    const peers = targets.filter((t) => t.kind !== "TEACHER");
    if (key === "q" || key === "\u0003") process.exit(0);
    if (key === "m") {
      state.auto = true;
      state.stepEndsAt = Date.now();
      log("AUTO mode");
      return;
    }
    const manual: Record<string, () => void> = {
      s: () => setZone("SCREEN", null),
      b: () => setZone("BOARD", "teacher"),
      a: () => setZone("AWAY", null),
      u: () => setZone("UNKNOWN", null),
      p: () => {
        const peer = peers[state.peerCursor++ % Math.max(peers.length, 1)];
        setZone("PERSON", peer?.id ?? null);
      },
    };
    const action = manual[key];
    if (action) {
      if (state.auto) log("MANUAL mode (press m for auto)");
      state.auto = false;
      action();
    }
  });
}

function log(msg: string) {
  console.log(`[mock-gaze ${new Date().toLocaleTimeString()}] ${msg}`);
}

log(`listening on ws://localhost:${PORT}  — keys: s b p a u | m=auto q=quit`);
