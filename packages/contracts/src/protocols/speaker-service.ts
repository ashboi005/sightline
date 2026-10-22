/**
 * Speaker service protocol: web app ↔ local look-to-hear service (apps/speaker-service, owner: Ashwath).
 *   ws://127.0.0.1:7799/live   (NEXT_PUBLIC_SPEAKER_SERVICE_URL) · GET http://127.0.0.1:7799/health
 *
 * NOTE: unlike the rest of the contracts, field names are snake_case because they mirror the Python
 * service's wire format exactly. Docs: docs/contracts/speaker-service.md.
 *
 * Frames:
 *  - JSON text: `SpeakerServiceCommand` (web → service) / `SpeakerServiceMessage` (service → web)
 *  - Binary (web → service only): 32-byte "GSP2" header + payload, built with `encodeSpeakerPacket`
 *      kind 1 = ≤ 200 ms float32 mono PCM @ 16 kHz (mixed room audio)
 *      kind 2 = one JPEG scene-camera frame
 */
import { z } from "zod";

import { Confidence, Timestamp } from "../domain/common";

export const SPEAKER_SERVICE_DEFAULT_URL = "ws://127.0.0.1:7799/live";
export const SPEAKER_SERVICE_PROTOCOL_VERSION = 3;
export const SPEAKER_SAMPLE_RATE = 16000;
export const SPEAKER_PACKET_MAGIC = "GSP2";
export const SPEAKER_PACKET_HEADER_BYTES = 32;
/** 200 ms of float32 PCM per packet, max. */
export const SPEAKER_MAX_PCM_SAMPLES = 3200;
export const SPEAKER_MAX_PACKET_BYTES = 220_000;

export const SpeakerPacketKind = { PCM: 1, FRAME: 2 } as const;
export type SpeakerPacketKind = (typeof SpeakerPacketKind)[keyof typeof SpeakerPacketKind];

/** Normalised [x, y, width, height] in the scene frame, origin top-left. */
export const FaceBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type FaceBox = z.infer<typeof FaceBox>;

export const FaceTrack = z.object({
  /** Session-local positional identity, not a recognised person. Expires when the face is lost. */
  id: z.string(),
  manual: z.boolean(),
  observations: z.array(z.object({ timestamp: z.number(), box: FaceBox })),
});
export type FaceTrack = z.infer<typeof FaceTrack>;

// ---------------------------------------------------------------------------
// Web → service (JSON)
// ---------------------------------------------------------------------------

export const SpeakerServiceCommand = z.discriminatedUnion("type", [
  /** Must be the first frame (within 5 s of connecting). */
  z.object({
    type: z.literal("configure"),
    protocol_version: z.literal(SPEAKER_SERVICE_PROTOCOL_VERSION),
    sample_rate: z.literal(SPEAKER_SAMPLE_RATE),
    audio: z.literal(true),
    source: z.enum(["camera", "network", "replay"]),
    /** The UI confirmed A/V alignment (e.g. clap test). The service refuses unverified sync. */
    sync_verified: z.literal(true),
    /** Video offset applied to frame sample indices, −500…500 ms. */
    video_offset_ms: z.number().min(-500).max(500),
    client_time: z.number().min(0),
  }),
  /** Select (or clear with null) the face to listen to. `generation` must increase on every change. */
  z.object({
    type: z.literal("target"),
    generation: z.number().int().min(1),
    target_id: z.string().max(64).nullable(),
    replay_start_sample: z.number().int().min(0).nullable().optional(),
  }),
  /** Manual correction: restrict detection to a region containing exactly one face (null clears). */
  z.object({ type: z.literal("region"), box: FaceBox.nullable() }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  /** Send at least every 5 s when nothing else is flowing. */
  z.object({ type: z.literal("heartbeat") }),
  /** Finish: drain everything accepted up to this source sample, then the service replies `drained`. */
  z.object({ type: z.literal("end"), source_end_sample: z.number().int().min(0) }),
  z.object({ type: z.literal("stop") }),
]);
export type SpeakerServiceCommand = z.infer<typeof SpeakerServiceCommand>;

// ---------------------------------------------------------------------------
// Service → web (JSON)
// ---------------------------------------------------------------------------

export const SpeakerServiceMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    generation: z.number().int(),
    device: z.string(),
    protocol_version: z.number().int(),
    analysis_mode: z.string(),
    engine: z.string(),
    minimum_samples: z.number().int(),
    history_samples: z.number().int(),
    maximum_input_samples: z.number().int(),
    noise_processor: z.string(),
    /** Seconds per warm inference — seed the playback buffer with these. */
    warm_timings: z.array(z.number()),
  }),
  /** Current face tracks (~5 Hz, from kind-2 frames). */
  z.object({ type: z.literal("faces"), generation: z.number().int(), tracks: z.array(FaceTrack) }),
  z.object({ type: z.literal("selected"), generation: z.number().int(), target_id: z.string().nullable() }),
  /** Focused audio for the current target. Play at `start_sample` on the source timeline. */
  z.object({
    type: z.literal("audio"),
    generation: z.number().int(),
    start_sample: z.number().int(),
    sample_count: z.number().int(),
    sample_rate: z.literal(SPEAKER_SAMPLE_RATE),
    capture_spans: z.array(
      z.object({ start_sample: z.number().int(), end_sample: z.number().int(), capture_time: z.number() }),
    ),
    device: z.string(),
    timings: z.record(z.string(), z.number()),
    queued_windows: z.number().int(),
    /** base64 little-endian float32 mono PCM — decode with `decodeSpeakerPcm`. */
    pcm: z.string(),
  }),
  /** Backpressure: `pause` = the device can't keep up (input stops; accepted audio drains). */
  z.object({
    type: z.literal("flow"),
    generation: z.number().int(),
    action: z.enum(["pause", "resume"]),
    queued_windows: z.number().int(),
    reason: z.string(),
  }),
  z.object({ type: z.literal("drained"), generation: z.number().int(), source_end_sample: z.number().int() }),
  /** e.g. synchronization_or_target_lost (reselect the face), live_busy, model_unready, invalid_live_input. */
  z.object({ type: z.literal("error"), code: z.string(), message: z.string(), generation: z.number().int() }),
]);
export type SpeakerServiceMessage = z.infer<typeof SpeakerServiceMessage>;

export const SpeakerHealth = z.object({
  ready: z.boolean(),
  model_state: z.enum(["loading", "ready", "unready"]),
  engine: z.string(),
  device: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  live: z.boolean(),
  streaming_ready: z.boolean(),
  streaming_error: z.string().nullable(),
  noise_processor: z.string().nullable(),
});
export type SpeakerHealth = z.infer<typeof SpeakerHealth>;

// ---------------------------------------------------------------------------
// Binary packets
// ---------------------------------------------------------------------------

/**
 * Build one binary packet: `"GSP2" | kind u8 | 3 pad | generation u32 | sample_start u64 | capture_time f64 | length u32`
 * (little-endian) + payload. `sampleStart` is the position on the 16 kHz *source* timeline (frames use the audio
 * sample index they align with); `captureTime` is the capture clock in seconds (monotonic, never backwards).
 */
export function encodeSpeakerPacket(
  kind: SpeakerPacketKind,
  generation: number,
  sampleStart: number,
  captureTime: number,
  payload: Uint8Array,
): ArrayBuffer {
  if (payload.byteLength === 0) throw new Error("Speaker packet payload is empty");
  if (kind === SpeakerPacketKind.PCM && payload.byteLength > SPEAKER_MAX_PCM_SAMPLES * 4) {
    throw new Error("PCM packets carry at most 200 ms (3200 float32 samples)");
  }
  const total = SPEAKER_PACKET_HEADER_BYTES + payload.byteLength;
  if (total > SPEAKER_MAX_PACKET_BYTES) throw new Error("Speaker packet too large");
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, SPEAKER_PACKET_MAGIC.charCodeAt(i));
  view.setUint8(4, kind);
  view.setUint32(8, generation >>> 0, true);
  view.setBigUint64(12, BigInt(sampleStart), true);
  view.setFloat64(20, captureTime, true);
  view.setUint32(28, payload.byteLength, true);
  new Uint8Array(buffer, SPEAKER_PACKET_HEADER_BYTES).set(payload);
  return buffer;
}

/** PCM chunk (≤ 3200 samples, values in [-1, 1]) → packet. */
export function encodeSpeakerPcm(generation: number, sampleStart: number, captureTime: number, pcm: Float32Array) {
  const bytes = new Uint8Array(pcm.byteLength);
  const view = new DataView(bytes.buffer);
  pcm.forEach((sample, i) => view.setFloat32(i * 4, sample, true));
  return encodeSpeakerPacket(SpeakerPacketKind.PCM, generation, sampleStart, captureTime, bytes);
}

/** base64 float32 LE from an `audio` message → Float32Array. */
export function decodeSpeakerPcm(base64: string): Float32Array {
  const binary = atob(base64);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(binary.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

// ---------------------------------------------------------------------------
// Gaze → target selection (dwell + hysteresis)
// ---------------------------------------------------------------------------

export const SceneGazeSample = z.object({
  /** Normalised position in the *scene camera* image (same orientation as the frames sent to the service). */
  x: z.number(),
  y: z.number(),
  valid: z.boolean(),
  confidence: Confidence,
  ts: Timestamp,
});
export type SceneGazeSample = z.infer<typeof SceneGazeSample>;

export type GazeTargetSelectorOptions = {
  /** How long gaze must stay on a new face before switching (ms). */
  dwellMs?: number;
  /** Box expansion (normalised units) for the *current* target, so small drifts don't drop it. */
  hysteresis?: number;
  /** Gaze older than this is ignored (ms). */
  staleMs?: number;
  minConfidence?: number;
};

/**
 * Decides which face the student is looking at. Feed it every gaze sample + the latest `faces` tracks; it returns
 * the target id to send (or `undefined` for "no change"). Stale, invalid, low-confidence or ambiguous gaze never
 * switches the target; a lost target returns `null` (send target null and ask the student to look again).
 */
export function createGazeTargetSelector(options: GazeTargetSelectorOptions = {}) {
  const dwellMs = options.dwellMs ?? 600;
  const hysteresis = options.hysteresis ?? 0.04;
  const staleMs = options.staleMs ?? 300;
  const minConfidence = options.minConfidence ?? 0.5;

  let current: string | null = null;
  let candidate: { id: string; since: number } | null = null;

  const contains = (box: FaceBox, x: number, y: number, pad: number) =>
    x >= box[0] - pad && x <= box[0] + box[2] + pad && y >= box[1] - pad && y <= box[1] + box[3] + pad;

  return {
    get current() {
      return current;
    },
    update(gaze: SceneGazeSample, tracks: FaceTrack[], now = Date.now()): string | null | undefined {
      const latest = (t: FaceTrack) => t.observations[t.observations.length - 1]?.box;
      if (current && !tracks.some((t) => t.id === current)) {
        current = null;
        candidate = null;
        return null;
      }
      if (!gaze.valid || gaze.confidence < minConfidence || now - gaze.ts > staleMs) return undefined;

      const currentBox = current ? latest(tracks.find((t) => t.id === current)!) : undefined;
      if (currentBox && contains(currentBox, gaze.x, gaze.y, hysteresis)) {
        candidate = null;
        return undefined;
      }
      const hits = tracks.filter((t) => {
        const box = latest(t);
        return box && contains(box, gaze.x, gaze.y, 0);
      });
      if (hits.length !== 1) {
        candidate = null; // nothing or ambiguous: keep the current target
        return undefined;
      }
      const hit = hits[0]!.id;
      if (!candidate || candidate.id !== hit) {
        candidate = { id: hit, since: now };
        return undefined;
      }
      if (now - candidate.since < dwellMs) return undefined;
      current = hit;
      candidate = null;
      return current;
    },
    reset() {
      current = null;
      candidate = null;
    },
  };
}
