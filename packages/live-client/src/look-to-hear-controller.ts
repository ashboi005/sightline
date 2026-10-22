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

export type LookToHearStatus = "CONNECTING" | "READY" | "LISTENING" | "TARGET_LOST" | "OVERLOADED" | "ERROR";

export type LookToHearState = {
  status: LookToHearStatus;
  faces: FaceTrack[];
  targetId: string | null;
  generation: number;
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
  onState?: (state: LookToHearState) => void;
  /** Capture clock in seconds (monotonic). */
  clock?: () => number;
  selector?: GazeTargetSelectorOptions;
};

export class LookToHearController {
  private readonly selector;
  private readonly chunker = new Chunker(SPEAKER_MAX_PCM_SAMPLES);
  private readonly clock: () => number;
  /** Samples of mic audio accepted so far = current position on the source timeline. */
  private sampleCursor = 0;
  /** Samples actually sent with the current target generation (for `end`). */
  private sentEnd = 0;
  private sentAny = false;
  private onDrained: (() => void) | null = null;
  state: LookToHearState = {
    status: "CONNECTING",
    faces: [],
    targetId: null,
    generation: 0,
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
    return this.sampleCursor;
  }

  onSpeakerMessage(msg: SpeakerServiceMessage) {
    switch (msg.type) {
      case "ready":
        this.set({ status: "READY", device: msg.device, noiseProcessor: msg.noise_processor, error: null });
        break;
      case "faces":
        if (msg.generation === this.state.generation) this.set({ faces: msg.tracks });
        break;
      case "selected":
        if (msg.generation === this.state.generation) {
          this.set({ targetId: msg.target_id, status: msg.target_id ? "LISTENING" : "READY" });
        }
        break;
      case "audio": {
        if (msg.generation !== this.state.generation) return; // stale target: drop
        // preparation + extraction + overlap; drain chunks report zeros, so keep the last real value.
        const seconds = Object.values(msg.timings).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
        if (seconds > 0) this.set({ lastInferenceSeconds: seconds });
        this.deps.onAudio(decodeSpeakerPcm(msg.pcm), msg.start_sample, msg.generation);
        break;
      }
      case "flow":
        this.set({ status: msg.action === "pause" ? "OVERLOADED" : this.state.targetId ? "LISTENING" : "READY" });
        break;
      case "error":
        if (msg.code === "synchronization_or_target_lost") {
          this.selector.reset();
          this.set({ status: "TARGET_LOST", targetId: null, generation: Math.max(this.state.generation, msg.generation), error: msg.message });
        } else {
          this.set({ status: "ERROR", error: `${msg.code}: ${msg.message}` });
        }
        break;
      case "drained":
        this.onDrained?.();
        break;
    }
  }

  /** Feed every `gaze.scene` from the gaze bridge. */
  onGaze(gaze: SceneGazeSample, now = Date.now()) {
    if (this.state.status === "CONNECTING" || this.state.status === "ERROR") return;
    const pick = this.selector.update(gaze, this.state.faces, now);
    if (pick === undefined) return;
    this.selectTarget(pick);
  }

  /** Click-to-select fallback (or clearing with null). */
  selectTarget(targetId: string | null) {
    const generation = this.state.generation + 1;
    this.sentAny = false;
    this.set({ generation, targetId, status: targetId ? "LISTENING" : "READY" });
    this.deps.send({ type: "target", generation, target_id: targetId });
  }

  /** Mic audio already at 16 kHz mono. Chunked into ≤ 200 ms packets. */
  pushMic(samples: Float32Array) {
    for (const chunk of this.chunker.push(samples)) {
      const start = this.sampleCursor;
      this.sampleCursor += chunk.length;
      // The service only accepts audio while a target is selected; frames keep flowing regardless.
      if (this.state.status === "LISTENING") {
        this.deps.sendBinary(encodeSpeakerPcm(this.state.generation, start, this.clock(), chunk));
        this.sentEnd = start + chunk.length;
        this.sentAny = true;
      }
    }
  }

  /** One JPEG scene frame, aligned to the current mic position. */
  pushFrame(jpeg: Uint8Array, sampleIndex = this.sampleCursor) {
    if (this.state.status === "CONNECTING" || this.state.status === "ERROR") return;
    this.deps.sendBinary(encodeSpeakerPacket(SpeakerPacketKind.FRAME, this.state.generation, sampleIndex, this.clock(), jpeg));
  }

  heartbeat() {
    this.deps.send({ type: "heartbeat" });
  }

  /** Drain what was sent for the current target (bounded wait), then stop. */
  async stop(drainTimeoutMs = 3000): Promise<void> {
    if (this.sentAny && this.state.status === "LISTENING") {
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
