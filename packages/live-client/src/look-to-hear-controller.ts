/**
 * OWNER: Ashwath. Look-to-hear orchestration with no DOM. Testable with fakes.
 *
 *   mic PCM (16 kHz) ─► pushMic ─► kind-1 packets ─┐
 *   scene JPEG       ─► pushFrame ─► kind-2 packets ┼─► speaker service
 *   gaze.scene       ─► onGaze ─► selector ─► target ┘
 *   speaker messages ─► onSpeakerMessage ─► faces / selected / audio (→ onAudio) / errors
 */
import {
  createGazeTargetSelector,
  decodeSpeakerPcm,
  encodeSpeakerPacket,
  encodeSpeakerPcm,
  SPEAKER_MAX_PCM_SAMPLES,
  SpeakerPacketKind,
  type FaceTrack,
  type GazeTargetSelectorOptions,
  type SceneGazeSample,
  type SpeakerServiceCommand,
  type SpeakerServiceMessage,
} from "@sightline/contracts";

import { Chunker } from "./pcm";

export type LookToHearStatus =
  | "CONNECTING"
  | "READY"
  | "LISTENING"
  | "TARGET_LOST"
  | "OVERLOADED"
  | "ERROR";

export type LookToHearState = {
  status: LookToHearStatus;
  faces: FaceTrack[];
  targetId: string | null;
  generation: number;
  engine: string | null;
  analysisSeconds: number | null;
  hasAudio: boolean;
  device: string | null;
  noiseProcessor: string | null;
  /** Most recent per-chunk processing time reported by the service (s): preparation + extraction + overlap. */
  lastInferenceSeconds: number | null;
  error: string | null;
};

export type LookToHearDeps = {
  send: (command: SpeakerServiceCommand) => void;
  sendBinary: (packet: ArrayBuffer) => void;
  /** Focused audio for the current generation, on the 16 kHz source timeline. */
  onAudio: (pcm: Float32Array, startSample: number, generation: number) => void;
  /** Cancel buffered playback immediately on selection changes, loss and disconnect. */
  onResetAudio?: (generation: number) => void;
  onState?: (state: LookToHearState) => void;
  /** Capture clock in seconds (monotonic). */
  clock?: () => number;
  selector?: GazeTargetSelectorOptions;
  selectionMode?: "dwell" | "confirmed";
  videoOffsetMs?: number;
};

export class LookToHearController {
  private readonly selector;
  private readonly chunker = new Chunker(SPEAKER_MAX_PCM_SAMPLES);
  private readonly clock: () => number;
  /** Samples of mic audio accepted so far = current position on the source timeline. */
  private sampleCursor = 0;
  private capturedSamples = 0;
  private capturedAt: number | null = null;
  private facesReceivedAt = -Infinity;
  /** Samples actually sent with the current target generation (for `end`). */
  private sentEnd = 0;
  private sentAny = false;
  private onDrained: (() => void) | null = null;
  state: LookToHearState = {
    status: "CONNECTING",
    faces: [],
    targetId: null,
    generation: 0,
    engine: null,
    analysisSeconds: null,
    hasAudio: false,
    device: null,
    noiseProcessor: null,
    lastInferenceSeconds: null,
    error: null,
  };

  constructor(private readonly deps: LookToHearDeps) {
    this.selector = createGazeTargetSelector(deps.selector);
    this.clock = deps.clock ?? (() => performance.now() / 1000);
  }

  private set(patch: Partial<LookToHearState>) {
    this.state = { ...this.state, ...patch };
    this.deps.onState?.(this.state);
  }

  /** Current position on the 16 kHz source timeline (tag scene frames with this). */
  get sourceSample() {
    return this.capturedSamples;
  }

  /** Map a frame's capture clock to the mic timeline, independent of JPEG encoding delay. */
  sourceSampleAt(captureTime: number) {
    if (this.capturedAt === null || !Number.isFinite(captureTime)) return null;
    return this.capturedSamples + Math.round((captureTime - this.capturedAt) * 16000);
  }

  onSpeakerMessage(msg: SpeakerServiceMessage) {
    if (this.state.status === "ERROR") return;
    switch (msg.type) {
      case "ready":
        this.deps.onResetAudio?.(msg.generation);
        this.set({
          status: "READY",
          generation: msg.generation,
          targetId: null,
          faces: [],
          engine: msg.engine,
          analysisSeconds: msg.minimum_samples / 16000,
          hasAudio: false,
          device: msg.device,
          noiseProcessor: msg.noise_processor,
          error: null,
        });
        break;
      case "faces":
        if (msg.generation === this.state.generation) {
          this.facesReceivedAt = this.clock();
          this.set({ faces: msg.tracks });
          this.checkFreshness();
        }
        break;
      case "selected":
        if (msg.generation === this.state.generation) {
          this.set({
            targetId: msg.target_id,
            status: msg.target_id ? "LISTENING" : "READY",
          });
        }
        break;
      case "audio": {
        if (
          msg.generation !== this.state.generation ||
          !this.state.targetId ||
          this.state.status !== "LISTENING"
        )
          return;
        this.checkFreshness();
        if (this.state.status !== "LISTENING") return;
        // New services report the total as well as its stages; count that total only once.
        // Drain chunks report zeros, so keep the last real value.
        const total = msg.timings.processing_seconds;
        const seconds = total !== undefined && Number.isFinite(total)
          ? total
          : Object.values(msg.timings).reduce(
              (sum, v) => sum + (Number.isFinite(v) ? v : 0),
              0,
            );
        this.set({
          hasAudio: true,
          ...(seconds > 0 ? { lastInferenceSeconds: seconds } : {}),
        });
        this.deps.onAudio(
          decodeSpeakerPcm(msg.pcm),
          msg.start_sample,
          msg.generation,
        );
        break;
      }
      case "flow":
        if (msg.generation !== this.state.generation) return;
        this.set({
          status:
            msg.action === "pause"
              ? "OVERLOADED"
              : this.state.targetId
                ? "LISTENING"
                : "READY",
        });
        if (msg.action === "pause")
          this.deps.onResetAudio?.(this.state.generation);
        break;
      case "error":
        if (msg.generation < this.state.generation) return;
        if (msg.code === "synchronization_or_target_lost") {
          this.selector.reset();
          this.deps.onResetAudio?.(
            Math.max(this.state.generation, msg.generation),
          );
          this.set({
            status: "TARGET_LOST",
            hasAudio: false,
            targetId: null,
            generation: Math.max(this.state.generation, msg.generation),
            error: msg.message,
          });
        } else {
          this.fail(`${msg.code}: ${msg.message}`);
        }
        break;
      case "drained":
        this.onDrained?.();
        break;
    }
  }

  /** Feed every `gaze.scene` from the gaze bridge. */
  onGaze(gaze: SceneGazeSample, now = Date.now()) {
    if (this.deps.selectionMode === "confirmed") return;
    if (this.state.status === "CONNECTING" || this.state.status === "ERROR")
      return;
    const pick = this.selector.update(gaze, this.state.faces, now);
    if (pick === undefined) return;
    this.selectTarget(pick);
  }

  /** A voice command confirms exactly one fresh face under the calibrated scene cursor. */
  selectAtGaze(
    gaze: SceneGazeSample | null,
    now = Date.now(),
  ): { ok: boolean; message: string } {
    if (
      !Number.isFinite(now) ||
      !gaze ||
      !gaze.valid ||
      !Number.isFinite(gaze.confidence) ||
      gaze.confidence < 0.5 ||
      !Number.isFinite(gaze.ts) ||
      now < gaze.ts ||
      now - gaze.ts > 500 ||
      ![gaze.x, gaze.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
    ) {
      return {
        ok: false,
        message:
          "Wait for fresh calibrated gaze, then look at the person's face and say select.",
      };
    }
    const hits = this.state.faces.filter((track) => {
      const box = track.observations.at(-1)?.box;
      return (
        this.isFresh(track) &&
        box &&
        box.every(Number.isFinite) &&
        box[2] > 0 &&
        box[3] > 0 &&
        gaze.x >= box[0] &&
        gaze.x <= box[0] + box[2] &&
        gaze.y >= box[1] &&
        gaze.y <= box[1] + box[3]
      );
    });
    if (hits.length !== 1)
      return {
        ok: false,
        message:
          hits.length > 1
            ? "More than one face is under the cursor. Look at one face and say select again."
            : "No fresh face under the cursor. Look inside a detected face and say select again.",
      };
    return this.selectTarget(hits[0]!.id);
  }

  private isFresh(track: FaceTrack) {
    const observation = track.observations.at(-1);
    const receiptAge = this.clock() - this.facesReceivedAt;
    const age =
      this.sourceSample / 16000 +
      (this.deps.videoOffsetMs ?? 0) / 1000 -
      (observation?.timestamp ?? -Infinity);
    return (
      receiptAge >= 0 &&
      receiptAge <= 1 &&
      Number.isFinite(age) &&
      age >= -0.2 &&
      age <= 1
    );
  }

  /** Runs even when a network camera freezes and the service has nothing new to send. */
  checkFreshness() {
    const fresh = this.state.faces.filter((track) => this.isFresh(track));
    if (fresh.length !== this.state.faces.length) this.set({ faces: fresh });
    if (!this.state.targetId) return;
    const target = this.state.faces.find(
      (face) => face.id === this.state.targetId,
    );
    if (target && this.isFresh(target)) return;
    this.selectTarget(null);
    this.set({
      status: "TARGET_LOST",
      error:
        "The selected face or camera feed was lost. Look at the face and select again.",
    });
  }

  onDisconnected() {
    this.selector.reset();
    this.chunker.flush();
    this.sampleCursor = this.capturedSamples = 0;
    this.capturedAt = null;
    this.sentAny = false;
    this.facesReceivedAt = -Infinity;
    this.deps.onResetAudio?.(0);
    this.set({
      status: "CONNECTING",
      targetId: null,
      faces: [],
      generation: 0,
      engine: null,
      analysisSeconds: null,
      hasAudio: false,
      error: null,
    });
  }

  fail(message: string) {
    const generation = this.state.generation + 1;
    this.selector.reset();
    this.deps.onResetAudio?.(generation);
    this.set({
      status: "ERROR",
      hasAudio: false,
      targetId: null,
      faces: [],
      generation,
      error: message,
    });
  }

  /** Click-to-select fallback (or clearing with null). */
  selectTarget(targetId: string | null): { ok: boolean; message: string } {
    if (
      targetId &&
      (this.state.status === "CONNECTING" ||
        this.state.status === "ERROR" ||
        this.state.status === "OVERLOADED")
    )
      return {
        ok: false,
        message: "Wait for the voice focus service to be ready.",
      };
    if (
      targetId &&
      !this.state.faces.some(
        (face) => face.id === targetId && this.isFresh(face),
      )
    )
      return {
        ok: false,
        message:
          "That face is no longer available. Wait for a fresh detection.",
      };
    if (targetId === this.state.targetId)
      return {
        ok: true,
        message: targetId
          ? "This person is already selected."
          : "Voice focus cleared.",
      };
    const generation = this.state.generation + 1;
    this.sentAny = false;
    this.chunker.flush();
    this.sampleCursor = this.capturedSamples;
    this.deps.onResetAudio?.(generation);
    this.set({
      generation,
      targetId,
      hasAudio: false,
      status: targetId ? "LISTENING" : "READY",
      error: null,
    });
    this.deps.send({ type: "target", generation, target_id: targetId });
    return {
      ok: true,
      message: targetId
        ? "Person selected. Their voice stays focused until cleared or lost."
        : "Voice focus cleared.",
    };
  }

  /** Mic audio already at 16 kHz mono. Chunked into ≤ 200 ms packets. */
  pushMic(samples: Float32Array) {
    this.capturedSamples += samples.length;
    const capturedEnd = this.clock();
    this.capturedAt = capturedEnd;
    for (const chunk of this.chunker.push(samples)) {
      const start = this.sampleCursor;
      this.sampleCursor += chunk.length;
      // The service only accepts audio while a target is selected; frames keep flowing regardless.
      if (this.state.status === "LISTENING") {
        this.deps.sendBinary(
          encodeSpeakerPcm(
            this.state.generation,
            start,
            capturedEnd - (this.capturedSamples - start) / 16000,
            chunk,
          ),
        );
        this.sentEnd = start + chunk.length;
        this.sentAny = true;
      }
    }
  }

  /** One JPEG scene frame, aligned to the current mic position. */
  pushFrame(
    jpeg: Uint8Array,
    sampleIndex = this.sourceSample,
    captureTime = this.clock(),
  ) {
    if (this.state.status === "CONNECTING" || this.state.status === "ERROR")
      return;
    this.deps.sendBinary(
      encodeSpeakerPacket(
        SpeakerPacketKind.FRAME,
        this.state.generation,
        sampleIndex,
        captureTime,
        jpeg,
      ),
    );
  }

  heartbeat() {
    this.deps.send({ type: "heartbeat" });
  }

  /** Drain what was sent for the current target (bounded wait), then stop. */
  async stop(drainTimeoutMs = 3000): Promise<void> {
    if (
      drainTimeoutMs > 0 &&
      this.sentAny &&
      this.state.status === "LISTENING"
    ) {
      const drained = new Promise<void>((resolve) => {
        this.onDrained = resolve;
        setTimeout(resolve, drainTimeoutMs);
      });
      this.deps.send({ type: "end", source_end_sample: this.sentEnd });
      await drained;
      this.onDrained = null;
    }
    this.deps.send({ type: "stop" });
  }
}
