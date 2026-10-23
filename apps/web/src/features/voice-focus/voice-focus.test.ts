import { expect, test } from "bun:test";
import { parseFocusCommand } from "./commands";
import { startSharedVoiceSession } from "./shared-voice";
import { VoiceFocusGaze } from "./calibrated-input";
import { DEFAULT_CAMERA_TRANSFORM } from "../scene-tracking/features/eye-tracking/camera-transform";
import type { SceneSessionSnapshot } from "../scene-tracking/features/scene-eye-tracking/scene-session.types";
import type { SceneCameraSnapshot } from "../scene-tracking/features/scene-eye-tracking/scene-camera.types";

test("focus voice commands cannot trigger ESP tracking or arbitrary room conversation", () => {
  expect(parseFocusCommand(" SELECT. ")).toBe("select");
  expect(parseFocusCommand("focus")).toBe("select");
  expect(parseFocusCommand("stop listening")).toBe("clear");
  expect(parseFocusCommand("clear selection")).toBe("clear");
  expect(parseFocusCommand("stop voice")).toBe("voice-stop");
  expect(parseFocusCommand("track")).toBeNull();
  expect(parseFocusCommand("please select the person")).toBeNull();
});

test("voice focus reuses the room microphone and releases only its recognizer on abort", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const originalLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location",
  );
  let worker: any;
  const messages: any[] = [];
  const listeners = new Set<(samples: Float32Array) => void>();
  let terminated = false;
  let microphoneStopped = false;
  class Worker {
    onmessage: any;
    constructor() {
      worker = this;
    }
    postMessage(message: any) {
      messages.push(message);
    }
    terminate() {
      terminated = true;
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: Worker,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "http://localhost" },
  });
  const context = Object.assign(new EventTarget(), { state: "running" });
  const mic = {
    context: context as AudioContext,
    subscribe(listener: (samples: Float32Array) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async stop() {
      microphoneStopped = true;
    },
  };
  const abort = new AbortController();
  const heard: string[] = [];
  try {
    const loading = startSharedVoiceSession(
      mic,
      (text) => heard.push(text),
      abort.signal,
      () => {},
    );
    worker.onmessage({ data: { event: "load", result: true } });
    const session = await loading;
    expect(JSON.parse(messages[2].grammar)).toContain("stop listening");
    expect(JSON.parse(messages[2].grammar)).not.toContain("track");
    for (const listener of listeners) listener(new Float32Array([0.5]));
    expect(messages.at(-1).sampleRate).toBe(16000);
    worker.onmessage({
      data: {
        event: "result",
        result: {
          text: "select",
          result: [{ word: "select", conf: 0.95, start: 0, end: 1 }],
        },
      },
    });
    expect(heard).toEqual(["select"]);
    abort.abort();
    expect(listeners.size).toBe(0);
    expect(terminated).toBe(true);
    expect(microphoneStopped).toBe(false);
    session.stop();
  } finally {
    abort.abort();
    if (original) Object.defineProperty(globalThis, "Worker", original);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (originalLocation)
      Object.defineProperty(globalThis, "location", originalLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
});

test("held gaze can be displayed across a dropped frame but cannot select a speaker", () => {
  const input = new VoiceFocusGaze();
  const scene = {
    source: { kind: "network", key: "POV", name: "POV" },
    connection: "live",
    busy: false,
    frame: { id: 1, timestamp: 1000, width: 640, height: 480, generation: 1 },
    transform: DEFAULT_CAMERA_TRANSFORM,
  } as SceneCameraSnapshot;
  const session = {
    calibration: {},
    offset: [0, 0],
    delayMs: 0,
    capture: null,
    measurement: {
      position: [0.2, 0.3],
      valid: true,
      confidence: 0.9,
      timestamp: 1000,
      eyeTimestamp: 1000,
      sceneTimestamp: 1000,
    },
  } as SceneSessionSnapshot;
  expect(input.read(session, scene, true, 1000).gaze).toMatchObject({
    x: 0.2,
    y: 0.3,
    ts: 1000,
  });
  const dropped = {
    ...session,
    measurement: { ...session.measurement!, valid: false, position: null },
  };
  const held = input.read(dropped, scene, true, 1100);
  expect(held.displayPoint).not.toBeNull();
  expect(held.gaze).toBeNull();
  expect(input.read(session, scene, false, 1000).gaze).toBeNull();
  expect(input.read(session, scene, true, 2000).gaze).toBeNull();
});
