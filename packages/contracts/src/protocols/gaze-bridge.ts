/**
 * Gaze bridge protocol — Arun's local daemon ↔ web app.   URL: ws://localhost:7777 (NEXT_PUBLIC_GAZE_BRIDGE_URL)
 *
 * The bridge owns the eye tracker and the voice-isolation pipeline. It is the WebSocket *server*;
 * the browser connects as a client. All frames are JSON text. Python implementers: see
 * packages/contracts/json-schema/gaze-bridge.*.json and docs/contracts/gaze-bridge.md.
 */
import { z } from "zod";

import { Confidence, SocketError, Timestamp } from "../domain/common";
import { FocusTarget, GazeZone } from "../domain/gaze";
import { AccessibilityMode } from "../domain/session";

export const GAZE_BRIDGE_DEFAULT_URL = "ws://localhost:7777";
export const GAZE_BRIDGE_PROTOCOL_VERSION = "1";

// ---------------------------------------------------------------------------
// Bridge → web
// ---------------------------------------------------------------------------

export const GazeBridgeMessage = z.discriminatedUnion("type", [
  /** Sent on connect and whenever anything changes. */
  z.object({
    type: z.literal("device.status"),
    protocolVersion: z.string(),
    tracker: z.enum(["CONNECTED", "DISCONNECTED"]),
    calibrated: z.boolean(),
    audioFocus: z.enum(["ACTIVE", "IDLE", "UNAVAILABLE"]),
    mode: AccessibilityMode,
    ts: Timestamp,
  }),
  /**
   * Current zone. Sent immediately on every change (debounced by the bridge, ~150 ms) and as a 1 Hz heartbeat.
   * `targetId` is set when zone = PERSON (or BOARD if the teacher is a known target).
   */
  z.object({
    type: z.literal("gaze.zone"),
    zone: GazeZone,
    targetId: z.string().nullable(),
    confidence: Confidence,
    ts: Timestamp,
  }),
  /** Optional on-screen gaze point, normalised 0..1 (0,0 = top-left). Only while subscribed and zone = SCREEN. */
  z.object({
    type: z.literal("gaze.point"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    ts: Timestamp,
  }),
  /** People/sources the bridge currently knows about. */
  z.object({ type: z.literal("gaze.targets"), targets: z.array(FocusTarget), ts: Timestamp }),
  /** Which voice is being isolated into the earphones right now (HARD_OF_HEARING mode). */
  z.object({
    type: z.literal("audio.focus"),
    targetId: z.string().nullable(),
    label: z.string().nullable(),
    locked: z.boolean(),
    ts: Timestamp,
  }),
  z.object({
    type: z.literal("calibration.progress"),
    step: z.number().int().nonnegative(),
    totalSteps: z.number().int().positive(),
    /** What the UI should tell the student, e.g. "Look at the top-left dot" / "Look at the board". */
    instruction: z.string(),
    /** Where to draw the dot for on-screen steps (normalised), null for "look at the board" steps. */
    target: z.object({ x: z.number(), y: z.number() }).nullable(),
    ts: Timestamp,
  }),
  z.object({
    type: z.literal("calibration.result"),
    ok: z.boolean(),
    quality: Confidence,
    message: z.string(),
    ts: Timestamp,
  }),
  SocketError,
]);
export type GazeBridgeMessage = z.infer<typeof GazeBridgeMessage>;

// ---------------------------------------------------------------------------
// Web → bridge
// ---------------------------------------------------------------------------

export const GazeBridgeCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), client: z.string(), protocolVersion: z.string() }),
  z.object({ type: z.literal("calibration.start") }),
  /** Web confirms the student is looking at the current target (e.g. after a click/space press). */
  z.object({ type: z.literal("calibration.confirm"), step: z.number().int().nonnegative() }),
  z.object({ type: z.literal("calibration.cancel") }),
  /** Audio focus runs only in HARD_OF_HEARING; DEAF mode only needs zones. */
  z.object({ type: z.literal("mode.set"), mode: AccessibilityMode }),
  /** Keep isolating this target even if gaze moves (e.g. "lock on teacher"). */
  z.object({ type: z.literal("audio.focus.lock"), targetId: z.string() }),
  z.object({ type: z.literal("audio.focus.unlock") }),
  z.object({ type: z.literal("gaze.point.subscribe"), enabled: z.boolean() }),
]);
export type GazeBridgeCommand = z.infer<typeof GazeBridgeCommand>;
