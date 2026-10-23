import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ACTIVE_LECTURE_KEY } from "@/lib/account-state";
import { DEFAULT_CAMERA_TRANSFORM } from "@/features/scene-tracking/features/eye-tracking/camera-transform";
import { MicrophoneInput } from "@/components/lecture/live/microphone-input";
import { SceneContext } from "./scene/context";
import type { SceneRuntime } from "./scene/runtime";
import { GazeProvider } from "./gaze-provider";
import {
  LiveLectureProvider,
  useLiveLecture,
  type LiveLecture,
} from "./live-lecture-provider";

if (typeof document === "undefined") GlobalRegistrator.register();
if (!document.doctype) document.insertBefore(document.implementation.createDocumentType("html", "", ""), document.firstChild);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let lecture: LiveLecture;
let query: QueryClient;
let stopped = false;
let rejectOutput = false;
let permission = Promise.resolve();
let contextCount = 0;
let resolvePermission: (() => void) | null;
let micRequests: MediaStreamConstraints[];
let failedDevice: string | null;
let inputs: {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
}[];
let mediaEvents: EventTarget;
const restores: (() => void)[] = [];
function replace(target: object, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  restores.push(() =>
    descriptor
      ? Object.defineProperty(target, key, descriptor)
      : Reflect.deleteProperty(target, key),
  );
  Object.defineProperty(target, key, { configurable: true, value });
}
function Harness() {
  lecture = useLiveLecture();
  return <MicrophoneInput />;
}
beforeEach(async () => {
  localStorage.removeItem(ACTIVE_LECTURE_KEY);
  stopped = false;
  rejectOutput = false;
  resolvePermission = null;
  permission = Promise.resolve();
  micRequests = [];
  failedDevice = null;
  inputs = [
    {
      deviceId: "room-mic",
      kind: "audioinput",
      label: "Room microphone",
      groupId: "room",
    },
    {
      deviceId: "headset-mic",
      kind: "audioinput",
      label: "Headset microphone",
      groupId: "headset",
    },
  ];
  class Node {
    gain = {
      value: 1,
      cancelScheduledValues() {},
      setValueAtTime() {},
      linearRampToValueAtTime() {},
    };
    port = { onmessage: null };
    connect(node: unknown) {
      return node;
    }
    disconnect() {}
  }
  contextCount = 0;
  class Context extends EventTarget {
    isOutput = contextCount++ > 0;
    state = "running";
    sampleRate = 48000;
    currentTime = 0;
    destination = new Node();
    audioWorklet = { async addModule() {} };
    async resume() {
      if (this.isOutput && rejectOutput) throw new Error("Output unavailable");
    }
    async close() {
      this.state = "closed";
      this.dispatchEvent(new Event("statechange"));
    }
    createMediaStreamSource() {
      return new Node();
    }
    createGain() {
      return new Node();
    }
  }
  class Socket {
    static OPEN = 1;
    readyState = 0;
    close() {
      this.readyState = 3;
    }
    send() {}
  }
  replace(globalThis, "AudioContext", Context);
  replace(globalThis, "AudioWorkletNode", Node);
  replace(globalThis, "WebSocket", Socket);
  replace(URL, "createObjectURL", () => "blob:mic");
  replace(URL, "revokeObjectURL", () => {});
  replace(
    navigator,
    "mediaDevices",
    Object.assign((mediaEvents = new EventTarget()), {
      enumerateDevices: async () => inputs,
      async getUserMedia(constraints: MediaStreamConstraints) {
        micRequests.push(constraints);
        if (
          typeof constraints.audio === "object" &&
          (constraints.audio.deviceId as ConstrainDOMStringParameters)
            ?.exact === failedDevice
        )
          throw new DOMException("Input unavailable", "OverconstrainedError");
        await permission;
        return {
          getTracks: () => [
            {
              stop() {
                stopped = true;
              },
            },
          ],
        };
      },
    }),
  );
  const camera = {
    getSnapshot: () => ({
      source: { key: "pov", kind: "network" },
      frame: {
        id: 1,
        generation: 1,
        width: 640,
        height: 480,
        timestamp: performance.now(),
      },
      connection: "live",
      busy: false,
      transform: DEFAULT_CAMERA_TRANSFORM,
    }),
    subscribe: () => () => {},
    rawCanvas: document.createElement("canvas"),
  };
  const runtime = {
    tracker: { settings: { locked: true }, connection: "live" },
    scene: { camera },
    state: {
      session: {
        getSnapshot: () => ({
          calibration: {},
          capture: null,
          offset: [0, 0],
          delayMs: 0,
          measurement: null,
        }),
      },
    },
    media: {
      video: document.createElement("video"),
      stream: null,
      error: null,
      stop() {},
    },
  } as unknown as SceneRuntime;
  query = new QueryClient({
    defaultOptions: {
      queries: { enabled: false, staleTime: Infinity, retry: false },
    },
  });
  query.setQueryData(["health"], { mocks: { speech: false } });
  query.setQueryData(["sessions", "one", "live"], {
    id: "live",
    status: "LIVE",
    mode: "DEAF",
  });
  root = createRoot((container = document.createElement("div")));
  await act(async () =>
    root.render(
      <QueryClientProvider client={query}>
        <GazeProvider>
          <SceneContext value={runtime}>
            <LiveLectureProvider>
              <Harness />
            </LiveLectureProvider>
          </SceneContext>
        </GazeProvider>
      </QueryClientProvider>,
    ),
  );
  await act(async () => lecture.voice.setSyncVerified(true));
});
afterEach(async () => {
  await act(async () => root.unmount());
  query.clear();
  for (const restore of restores.splice(0).reverse()) restore();
  localStorage.removeItem(ACTIVE_LECTURE_KEY);
});
async function chooseMicrophone(deviceId = "room-mic") {
  await act(async () => lecture.mic.select(deviceId));
  await act(async () => lecture.voice.setSyncVerified(true));
}
test("stopping standalone voice focus releases its microphone", async () => {
  await chooseMicrophone();
  await act(async () => lecture.voice.start());
  expect(lecture.mic.mic).not.toBeNull();
  await act(async () => lecture.voice.stop());
  expect(stopped).toBe(true);
  expect(lecture.mic.mic).toBeNull();
});
test("failed standalone startup releases microphone capture", async () => {
  await chooseMicrophone();
  rejectOutput = true;
  await act(async () => lecture.voice.start());
  expect(lecture.voice.error).toContain("Output unavailable");
  expect(stopped).toBe(true);
  expect(lecture.mic.mic).toBeNull();
});
test("cancelling during microphone permission cannot start focus after permission resolves", async () => {
  await chooseMicrophone();
  permission = new Promise<void>((resolve) => {
    resolvePermission = resolve;
  });
  let starting!: Promise<void>;
  await act(async () => {
    starting = lecture.voice.start();
  });
  await act(async () => lecture.voice.stop());
  expect(lecture.mic.busy).toBe(false);
  expect(container.querySelector("select")!.disabled).toBe(false);
  await act(async () => {
    resolvePermission!();
    await starting;
  });
  expect(stopped).toBe(true);
  expect(lecture.mic.mic).toBeNull();
  expect(lecture.voice.active).toBe(false);
});
test("stopping focus preserves the microphone used by an active lecture", async () => {
  await chooseMicrophone();
  await act(async () => lecture.attach("live"));
  await act(async () => lecture.voice.start());
  await act(async () => lecture.voice.stop());
  expect(stopped).toBe(false);
  expect(lecture.mic.mic).not.toBeNull();
});

test("leaving the workspace during microphone permission disposes the late capture without starting focus", async () => {
  await chooseMicrophone();
  permission = new Promise<void>((resolve) => {
    resolvePermission = resolve;
  });
  let starting!: Promise<void>;
  await act(async () => {
    starting = lecture.voice.start();
  });
  await act(async () => root.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => {
    resolvePermission!();
    await starting;
  });
  expect(stopped).toBe(true);
  // Only the late microphone context; never create a focused-audio output after unmount.
  expect(contextCount).toBe(1);
});

test("voice focus never opens a default microphone before the user selects an input", async () => {
  expect(lecture.mic.deviceId).toBe("");
  await act(async () => lecture.voice.start());
  expect(micRequests).toHaveLength(0);
  expect(lecture.voice.active).toBe(false);
  expect(lecture.mic.error).toContain("Choose a microphone");
});

test("voice focus captures exactly the user-selected microphone", async () => {
  await chooseMicrophone("headset-mic");
  await act(async () => lecture.voice.start());
  expect(micRequests).toHaveLength(1);
  expect(micRequests[0]?.audio).toMatchObject({
    deviceId: { exact: "headset-mic" },
  });
  expect(lecture.mic.deviceId).toBe("headset-mic");
});

test("changing microphones stops focus and invalidates audio-video timing before another capture", async () => {
  await chooseMicrophone();
  await act(async () => lecture.voice.start());
  expect(lecture.voice.active).toBe(true);
  await act(async () => lecture.mic.select("headset-mic"));
  expect(stopped).toBe(true);
  expect(lecture.voice.active).toBe(false);
  expect(lecture.voice.syncVerified).toBe(false);
  expect(micRequests).toHaveLength(1);
  expect(lecture.mic.deviceId).toBe("headset-mic");
});

test("a missing selected microphone fails without retrying a default input", async () => {
  await chooseMicrophone("headset-mic");
  failedDevice = "headset-mic";
  await act(async () => lecture.voice.start());
  expect(micRequests).toHaveLength(1);
  expect(lecture.mic.error).toContain("No microphone was found");
  expect(lecture.voice.active).toBe(false);
});

test("unplugging the selected microphone stops focus without choosing another input", async () => {
  await chooseMicrophone("headset-mic");
  await act(async () => lecture.voice.start());
  expect(lecture.voice.active).toBe(true);
  await act(async () => {
    inputs = inputs.filter((input) => input.deviceId !== "headset-mic");
    mediaEvents.dispatchEvent(new Event("devicechange"));
  });
  expect(stopped).toBe(true);
  expect(lecture.voice.active).toBe(false);
  expect(lecture.mic.deviceId).toBe("headset-mic");
  expect(lecture.mic.error).toContain("disconnected");
  expect(micRequests).toHaveLength(1);
});

test("changing input during permission disposes the old capture without reviving focus", async () => {
  await chooseMicrophone();
  permission = new Promise<void>((resolve) => {
    resolvePermission = resolve;
  });
  let starting!: Promise<void>;
  await act(async () => {
    starting = lecture.voice.start();
  });
  await act(async () => lecture.mic.select("headset-mic"));
  await act(async () => {
    resolvePermission!();
    await starting;
  });
  expect(stopped).toBe(true);
  expect(lecture.mic.deviceId).toBe("headset-mic");
  expect(lecture.voice.active).toBe(false);
  expect(micRequests).toHaveLength(1);
});

test("a microphone change restarts live captions on the selected device", async () => {
  await chooseMicrophone();
  await act(async () => lecture.attach("live"));
  await act(async () => lecture.voice.start());
  await act(async () => lecture.mic.select("headset-mic"));
  expect(lecture.voice.active).toBe(false);
  expect(lecture.mic.mic).not.toBeNull();
  expect(micRequests).toHaveLength(2);
  expect(micRequests.at(-1)?.audio).toMatchObject({
    deviceId: { exact: "headset-mic" },
  });
});

test("the microphone picker waits for an explicit UI selection and forwards that device to capture", async () => {
  const input = container.querySelector("select")!;
  expect(input.value).toBe("");
  expect(micRequests).toHaveLength(0);
  await act(async () => {
    input.value = "headset-mic";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(lecture.mic.deviceId).toBe("headset-mic");
  expect(micRequests).toHaveLength(0);
  await act(async () => lecture.voice.setSyncVerified(true));
  await act(async () => lecture.voice.start());
  expect(micRequests[0]?.audio).toMatchObject({
    deviceId: { exact: "headset-mic" },
  });
});
