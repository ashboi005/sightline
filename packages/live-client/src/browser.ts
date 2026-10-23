/**
 * OWNER: Ashwath. Browser-only wiring (Web Audio, getUserMedia, canvas). Sahil's UI calls these.
 *
 *   const mic = await startMicCapture();                                  // one mic for everything
 *   const captions = streamMicToSession(sessionSocket, mic);              // live captions (Deepgram)
 *   const lth = await startLookToHear({ mic, sceneVideo, speakerUrl, gazeBridgeUrl, onState });  // look → hear
 */
import {
  connectGazeBridge,
  connectSpeakerService,
  type TypedSocket,
} from "@sightline/contracts/client";
import type { GazeZone, SceneGazeSample, SessionClientMessage, SessionServerMessage, SnapshotTrigger } from "@sightline/contracts";

import { LookToHearController, type LookToHearState } from "./look-to-hear-controller";
import { Chunker, floatToLinear16, StreamingResampler, TARGET_RATE } from "./pcm";
import { PlaybackScheduler } from "./playback-scheduler";
import { BoardDwellTrigger, SnapshotGate, VisualChangeDetector, type VisualChangeOptions } from "./snapshot-triggers";

// ---------------------------------------------------------------------------
// Microphone: one capture, many subscribers, always 16 kHz mono Float32
// ---------------------------------------------------------------------------

const WORKLET = `
class SightlineMicTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("sightline-mic-tap", SightlineMicTap);
`;

export type MicCapture = {
  readonly context: AudioContext;
  subscribe(listener: (samples16k: Float32Array) => void): () => void;
  stop(): Promise<void>;
};

export async function startMicCapture(options: { deviceId?: string } = {}): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
      channelCount: 1,
      // The room mix is what the separator needs — don't let the browser "clean" it.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const context = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  await context.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, "sightline-mic-tap");
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(context.destination);

  const resampler = new StreamingResampler(context.sampleRate, TARGET_RATE);
  const listeners = new Set<(s: Float32Array) => void>();
  tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const samples = resampler.process(event.data);
    if (samples.length) for (const l of listeners) l(samples);
  };

  return {
    context,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async stop() {
      listeners.clear();
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      for (const track of stream.getTracks()) track.stop();
      await context.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Captions: mic → session socket (LINEAR16 binary frames for Deepgram)
// ---------------------------------------------------------------------------

/** ~100 ms of 16 kHz audio per binary frame, as the session socket contract expects. */
const MIC_FRAME_SAMPLES = TARGET_RATE / 10;

export function streamMicToSession(socket: TypedSocket<SessionClientMessage>, mic: MicCapture) {
  socket.send({ type: "audio.start", format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 }, ts: Date.now() });
  // The mic delivers ~2–3 ms per worklet callback; forwarding each one floods the STT provider with tiny
  // chunks (ElevenLabs Scribe returns nothing). Batch into 100 ms frames.
  const chunker = new Chunker(MIC_FRAME_SAMPLES);
  const unsubscribe = mic.subscribe((samples) => {
    for (const frame of chunker.push(samples)) socket.sendBinary(floatToLinear16(frame));
  });
  return {
    stop() {
      unsubscribe();
      const rest = chunker.flush();
      if (rest) socket.sendBinary(floatToLinear16(rest));
      socket.send({ type: "audio.stop", ts: Date.now() });
    },
  };
}

// ---------------------------------------------------------------------------
// Scene frames: <video> (scene camera / ESP32 stream / file) → JPEG bytes
// ---------------------------------------------------------------------------

export type SceneFrameCapture = {
  key: string;
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Original decoded-frame time, performance.now() milliseconds. */
  capturedAt: number;
};

export function startFrameGrabber(
  video: HTMLVideoElement,
  onFrame: (jpeg: Uint8Array, capturedAt: number) => void,
  options: {
    fps?: number;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    readFrame?: () => SceneFrameCapture | null;
  } = {},
) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  let busy = false;
  let stopped = false;
  let lastKey: string | null = null;
  const timer = setInterval(
    () => {
      if (stopped || busy) return;
      const frame = options.readFrame
        ? options.readFrame()
        : video.readyState >= 2 && video.videoWidth
          ? {
              key: String(video.currentTime),
              image: video,
              width: video.videoWidth,
              height: video.videoHeight,
              capturedAt: performance.now(),
            }
          : null;
      if (
        !frame ||
        frame.key === lastKey ||
        performance.now() - frame.capturedAt > 1000 ||
        !Number.isFinite(frame.capturedAt) ||
        frame.capturedAt > performance.now()
      )
        return;
      const scale = Math.min(
        1,
        (options.maxWidth ?? 640) / frame.width,
        (options.maxHeight ?? 480) / frame.height,
      );
      canvas.width = Math.round(frame.width * scale);
      canvas.height = Math.round(frame.height * scale);
      ctx.drawImage(frame.image, 0, 0, canvas.width, canvas.height);
      lastKey = frame.key;
      busy = true;
      canvas.toBlob(
        async (blob) => {
          try {
            if (blob && !stopped) {
              const bytes = new Uint8Array(await blob.arrayBuffer());
              if (!stopped) onFrame(bytes, frame.capturedAt);
            }
          } finally {
            busy = false;
          }
        },
        "image/jpeg",
        options.quality ?? 0.7,
      );
    },
    1000 / (options.fps ?? 25),
  );
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// Focused-voice player (earphones)
// ---------------------------------------------------------------------------

export class FocusedAudioPlayer {
  private readonly scheduler: PlaybackScheduler;
  private readonly gain: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private minimumGeneration = 0;
  private stopped = false;
  private routing = false;

  constructor(
    private readonly context: AudioContext,
    options: { initialDelay?: number } = {},
  ) {
    this.scheduler = new PlaybackScheduler({
      initialDelay: options.initialDelay ?? 0.4,
    });
    this.gain = context.createGain();
    this.gain.connect(context.destination);
  }

  /** Current buffering delay (s): starts at initialDelay, grows after underruns. */
  get delay() {
    return this.scheduler.delay;
  }

  play(pcm: Float32Array, startSample: number, generation: number) {
    if (this.stopped || this.routing || generation < this.minimumGeneration)
      return;
    if (generation > this.scheduler.currentGeneration) this.reset(generation);
    const slot = this.scheduler.schedule(
      generation,
      startSample,
      pcm.length,
      this.context.currentTime,
    );
    if (!slot) return;
    const fresh = pcm.subarray(slot.offsetSamples);
    const buffer = this.context.createBuffer(1, fresh.length, TARGET_RATE);
    buffer.copyToChannel(fresh as Float32Array<ArrayBuffer>, 0);
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.gain);
    node.start(slot.when);
    node.onended = () =>
      (this.sources = this.sources.filter((s) => s !== node));
    this.sources.push(node);
  }

  /** Use the requested output, or reject explicitly; never silently substitute another speaker. */
  async setOutputDevice(deviceId: string) {
    this.reset(this.minimumGeneration);
    this.routing = true;
    try {
      const context = this.context as AudioContext & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (context.setSinkId) await context.setSinkId(deviceId);
      else if (deviceId && deviceId !== "default")
        throw new Error(
          "This browser cannot select an audio output. Use a browser with speaker selection or choose the system default.",
        );
    } finally {
      this.routing = false;
    }
  }

  reset(generation: number) {
    this.minimumGeneration = generation;
    this.fadeOutCurrent();
    this.scheduler.reset();
  }

  /** Stop queued speech immediately; fade in the next target to avoid a click. */
  private fadeOutCurrent() {
    const now = this.context.currentTime;
    for (const s of this.sources) {
      try {
        s.stop(now);
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(1, now + 0.05);
  }

  stop() {
    this.stopped = true;
    this.fadeOutCurrent();
    this.gain.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Look → hear: everything wired together
// ---------------------------------------------------------------------------

export async function startLookToHear(options: {
  mic: MicCapture;
  sceneVideo: HTMLVideoElement;
  speakerUrl: string;
  gazeBridgeUrl?: string;
  selectionMode?: "dwell" | "confirmed";
  outputDeviceId?: string;
  readFrame?: () => SceneFrameCapture | null;
  /** Cancels pending audio initialization before the session is returned. */
  signal?: AbortSignal;
  source?: "camera" | "network" | "replay";
  /** Manual A/V alignment offset from the UI's clap test (ms). */
  videoOffsetMs?: number;
  onState?: (state: LookToHearState & { playbackDelay: number }) => void;
}) {
  options.signal?.throwIfAborted();
  if (options.mic.context.state === "closed")
    throw new Error(
      "The microphone disconnected. Reconnect it before starting voice focus.",
    );
  // Playback owns its output/context. Changing speakers never reroutes the shared caption microphone.
  const output = new AudioContext();
  const player = new FocusedAudioPlayer(output);
  let rejectStartup!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectStartup = reject;
  });
  const abort = () =>
    rejectStartup(
      options.signal?.reason ??
        new DOMException("Voice focus stopped", "AbortError"),
    );
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await Promise.race([
      cancelled,
      (async () => {
        if (options.mic.context.state !== "running")
          await options.mic.context.resume();
        options.signal?.throwIfAborted();
        await output.resume();
        options.signal?.throwIfAborted();
        await player.setOutputDevice(options.outputDeviceId ?? "");
        options.signal?.throwIfAborted();
      })(),
    ]);
  } catch (error) {
    player.stop();
    await output.close();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  let stopped = false;
  let minimumFrameTime = -Infinity;
  let speaker: ReturnType<typeof connectSpeakerService> | null = null;
  let gaze: ReturnType<typeof connectGazeBridge> | null = null;
  let unsubscribeMic = () => {};
  let frames: ReturnType<typeof startFrameGrabber> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let freshness: ReturnType<typeof setInterval> | undefined;
  const controller = new LookToHearController({
    send: (c) => speaker?.send(c),
    sendBinary: (p) => speaker?.sendBinary(p),
    onAudio: (pcm, start, generation) => {
      if (!stopped) player.play(pcm, start, generation);
    },
    onResetAudio: (generation) => {
      player.reset(generation);
    },
    onState: (s) => {
      if (!stopped) options.onState?.({ ...s, playbackDelay: player.delay });
    },
    selectionMode: options.selectionMode,
    videoOffsetMs: options.videoOffsetMs,
  });
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    player.stop();
    clearInterval(heartbeat);
    clearInterval(freshness);
    frames?.stop();
    unsubscribeMic();
    gaze?.close();
    try {
      await controller.stop(0);
    } finally {
      speaker?.close();
      await output.close();
    }
  };
  try {
    speaker = connectSpeakerService(
      options.speakerUrl,
      {
        source: options.source ?? "camera",
        videoOffsetMs: options.videoOffsetMs ?? 0,
      },
      {
        onMessage: (m) => {
          if (!stopped) controller.onSpeakerMessage(m);
        },
        onStatus: (status) => {
          if (!stopped && status !== "OPEN") {
            minimumFrameTime = performance.now();
            controller.onDisconnected();
          }
        },
      },
    );

    gaze = options.gazeBridgeUrl
      ? connectGazeBridge(options.gazeBridgeUrl, {
          onMessage: (m) => {
            if (m.type === "gaze.scene") controller.onGaze(m);
          },
        })
      : null;
    unsubscribeMic = options.mic.subscribe((s) => controller.pushMic(s));
    frames = startFrameGrabber(
      options.sceneVideo,
      (jpeg, capturedAt) => {
        const age = performance.now() - capturedAt;
        if (stopped || capturedAt < minimumFrameTime || age > 1000) return;
        const sample = controller.sourceSampleAt(capturedAt / 1000);
        if (sample !== null && sample >= 0)
          controller.pushFrame(jpeg, sample, capturedAt / 1000);
      },
      { readFrame: options.readFrame },
    );
    heartbeat = setInterval(() => controller.heartbeat(), 2000);
    freshness = setInterval(() => controller.checkFreshness(), 100);

    return {
      controller,
      /** Click-to-select a face (or null to stop listening). */
      select: (targetId: string | null) => controller.selectTarget(targetId),
      selectAtGaze: (gaze: SceneGazeSample | null, now?: number) =>
        controller.selectAtGaze(gaze, now),
      async setOutputDevice(deviceId: string) {
        try {
          await player.setOutputDevice(deviceId);
        } catch (error) {
          controller.fail(
            error instanceof Error ? error.message : "Audio output failed.",
          );
          await stop();
          throw error;
        }
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Smart snapshots: board/diagram frames → notes
// ---------------------------------------------------------------------------

/**
 * Captures scene-camera frames into the lecture notes when:
 *  - the server hears a visual cue (`snapshot.request` on the session socket → call `onSessionMessage`)
 *  - the student keeps looking at the board (`onGazeZone`)
 *  - the board visibly changes and settles (internal 2 fps thumbnail check)
 *  - the student presses a button (`capture("MANUAL")`)
 */
export function startSmartSnapshots(options: {
  video: HTMLVideoElement;
  upload: (image: Blob, fields: { trigger: SnapshotTrigger; reason?: string; capturedAt?: number }) => Promise<unknown>;
  visualChange?: VisualChangeOptions | false;
  boardDwellMs?: number;
  cooldownMs?: number;
  onCaptured?: (trigger: SnapshotTrigger) => void;
}) {
  const gate = new SnapshotGate(options.cooldownMs);
  const dwell = new BoardDwellTrigger(options.boardDwellMs);
  const detector = options.visualChange === false ? null : new VisualChangeDetector(options.visualChange || {});
  const frame = document.createElement("canvas");
  const thumb = document.createElement("canvas");
  thumb.width = 32;
  thumb.height = 18;
  const thumbCtx = thumb.getContext("2d", { willReadFrequently: true })!;

  const grab = () =>
    new Promise<Blob | null>((resolve) => {
      const v = options.video;
      if (v.readyState < 2 || !v.videoWidth) return resolve(null);
      const scale = Math.min(1, 1280 / v.videoWidth);
      frame.width = Math.round(v.videoWidth * scale);
      frame.height = Math.round(v.videoHeight * scale);
      frame.getContext("2d")!.drawImage(v, 0, 0, frame.width, frame.height);
      frame.toBlob(resolve, "image/jpeg", 0.85);
    });

  async function capture(trigger: SnapshotTrigger, reason?: string) {
    const automatic = trigger === "BOARD_DWELL" || trigger === "VISUAL_CHANGE";
    if (automatic && !gate.allow(Date.now())) return;
    const capturedAt = Date.now();
    const image = await grab();
    if (!image) return;
    await options.upload(image, { trigger, reason, capturedAt });
    options.onCaptured?.(trigger);
  }

  const timer = detector
    ? setInterval(() => {
        const v = options.video;
        if (v.readyState < 2) return;
        thumbCtx.drawImage(v, 0, 0, thumb.width, thumb.height);
        const rgba = thumbCtx.getImageData(0, 0, thumb.width, thumb.height).data;
        const gray = new Uint8Array(thumb.width * thumb.height);
        for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4]! * 0.299 + rgba[i * 4 + 1]! * 0.587 + rgba[i * 4 + 2]! * 0.114) | 0;
        if (detector.feed(gray, Date.now())) void capture("VISUAL_CHANGE", "New content appeared on the board");
      }, 500)
    : null;

  return {
    capture,
    /** Pass every message from the session socket. */
    onSessionMessage(msg: SessionServerMessage) {
      if (msg.type === "snapshot.request") void capture(msg.trigger, msg.reason);
    },
    /** Pass every `gaze.zone` from the gaze bridge. */
    onGazeZone(zone: GazeZone) {
      if (dwell.update(zone, Date.now())) void capture("BOARD_DWELL", "You looked at the board for a while");
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
