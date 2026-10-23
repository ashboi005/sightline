import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MicCapture } from "@sightline/live-client";
import { SceneContext } from "@/providers/scene/context";
import type { SceneRuntime } from "@/providers/scene/runtime";
import { DEFAULT_CAMERA_TRANSFORM } from "@/features/scene-tracking/features/eye-tracking/camera-transform";
import { useVoiceFocus } from "./use-voice-focus";

if (typeof document === "undefined") GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let focus: ReturnType<typeof useVoiceFocus>;
const saved = new Map<string, PropertyDescriptor | undefined>();
let fixture: ReturnType<typeof platform>;
let savedMedia: PropertyDescriptor | undefined;

function platform() {
  const sockets: Socket[] = [];
  const contexts: Context[] = [];
  const cameraListeners = new Set<() => void>();
  const samples = new Set<(pcm: Float32Array) => void>();
  const camera = {
    source: { kind: "network", key: "pov", name: "POV" },
    connection: "live",
    busy: false,
    frame: {
      id: 1,
      generation: 1,
      timestamp: performance.now(),
      width: 640,
      height: 480,
    },
    transform: DEFAULT_CAMERA_TRANSFORM,
  };
  const measurement = {
    valid: true,
    confidence: 0.95,
    position: [0.2, 0.3],
    timestamp: performance.now(),
    eyeTimestamp: performance.now(),
    sceneTimestamp: performance.now(),
  };
  let worker: Worker | null = null;
  let failSocket = false;
  let releaseOutput: (() => void) | null = null;
  let outputWait: Promise<void> | null = null;
  class Context extends EventTarget {
    state = "running";
    currentTime = 0;
    destination = {};
    sinks: string[] = [];
    async resume() {
      await outputWait;
    }
    async close() {
      this.state = "closed";
      this.dispatchEvent(new Event("statechange"));
    }
    async setSinkId(id: string) {
      if (id === "unavailable") throw new Error("Requested speaker rejected");
      this.sinks.push(id);
    }
    constructor() {
      super();
      contexts.push(this);
    }
    createGain() {
      return {
        connect() {},
        disconnect() {},
        gain: {
          cancelScheduledValues() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
      };
    }
  }
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent: any[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly url: string) {
      if (failSocket) throw new Error("Invalid service URL");
      sockets.push(this);
    }
    send(data: unknown) {
      this.sent.push(typeof data === "string" ? JSON.parse(data) : data);
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    message(data: unknown) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
  }
  class Worker {
    onmessage: ((event: unknown) => void) | null = null;
    terminated = false;
    constructor() {
      worker = this;
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
    load() {
      this.onmessage?.({ data: { event: "load", result: true } });
    }
    say(text: string) {
      this.onmessage?.({
        data: {
          event: "result",
          result: {
            text,
            result: text
              .split(" ")
              .map((word) => ({ word, conf: 0.98, start: 0, end: 1 })),
          },
        },
      });
    }
  }
  for (const [name, value] of Object.entries({
    AudioContext: Context,
    WebSocket: Socket,
    Worker,
    location: { origin: "http://localhost:3011" },
  })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const microphone = Object.assign(new EventTarget(), {
    state: "running",
  }) as AudioContext;
  savedMedia = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  let outputs = [
    {
      deviceId: "hearing-aids",
      kind: "audiooutput",
      label: "Hearing aids",
      groupId: "",
    },
  ];
  const media = Object.assign(new EventTarget(), {
    enumerateDevices: async () => outputs,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: media,
  });
  let micStopped = false;
  const mic: MicCapture = {
    context: microphone,
    subscribe(callback) {
      samples.add(callback);
      return () => {
        samples.delete(callback);
      };
    },
    async stop() {
      micStopped = true;
    },
  };
  const runtime = {
    tracker: { settings: { locked: true }, connection: "live" },
    scene: {
      camera: {
        rawCanvas: document.createElement("canvas"),
        getSnapshot: () => camera,
        subscribe: (listener: () => void) => {
          cameraListeners.add(listener);
          return () => {
            cameraListeners.delete(listener);
          };
        },
      },
    },
    state: {
      session: {
        getSnapshot: () => ({
          calibration: {},
          capture: null,
          offset: [0, 0],
          delayMs: 0,
          measurement,
        }),
      },
    },
  } as unknown as SceneRuntime;
  return {
    runtime,
    camera,
    measurement,
    sockets,
    contexts,
    mic,
    samples,
    failSocket: () => {
      failSocket = true;
    },
    holdOutput: () => {
      outputWait = new Promise<void>((resolve) => {
        releaseOutput = resolve;
      });
    },
    releaseOutput: () => releaseOutput?.(),
    disconnectOutput: () => {
      outputs = [];
      media.dispatchEvent(new Event("devicechange"));
    },
    changeCamera: () => {
      camera.source.key = "replacement";
      cameraListeners.forEach((listener) => listener());
    },
    get worker() {
      return worker;
    },
    get micStopped() {
      return micStopped;
    },
    ready() {
      sockets[0]!.open();
      sockets[0]!.message({
        type: "ready",
        generation: 0,
        device: "cpu",
        protocol_version: 3,
        analysis_mode: "available",
        engine: "rtfs",
        minimum_samples: 1920,
        history_samples: 6400,
        maximum_input_samples: 128000,
        noise_processor: "off",
        warm_timings: [],
      });
    },
    faces(ids = ["A", "B"], generation = 0) {
      sockets[0]!.message({
        type: "faces",
        generation,
        tracks: ids.map((id, i) => ({
          id,
          manual: false,
          observations: [{ timestamp: 0, box: [i ? 0.7 : 0.1, 0.2, 0.2, 0.3] }],
        })),
      });
    },
  };
}
function Harness() {
  focus = useVoiceFocus();
  return null;
}
beforeEach(async () => {
  fixture = platform();
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      createElement(
        SceneContext,
        { value: fixture.runtime },
        createElement(Harness),
      ),
    );
  });
  await act(() => focus.setSyncVerified(true));
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  saved.clear();
  if (savedMedia) Object.defineProperty(navigator, "mediaDevices", savedMedia);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

test("voice selection reaches only the real speaker protocol using calibrated POV coordinates", async () => {
  await act(async () => {
    await Promise.all([
      focus.start(fixture.mic, document.createElement("video")),
      focus.start(fixture.mic, document.createElement("video")),
    ]);
  });
  expect(fixture.sockets).toHaveLength(1);
  await act(() => {
    fixture.ready();
    fixture.faces();
  });
  expect(fixture.sockets[0]!.sent[0]).toMatchObject({
    type: "configure",
    source: "network",
    sync_verified: true,
  });
  await act(() => focus.toggleVoice());
  await act(async () => {
    fixture.worker!.load();
    await Promise.resolve();
  });
  await act(() => fixture.worker!.say("select"));
  expect(focus.state?.targetId).toBe("A");
  expect(fixture.sockets[0]!.sent.at(-1)).toEqual({
    type: "target",
    generation: 1,
    target_id: "A",
  });
  fixture.measurement.position = [0.8, 0.3];
  expect(focus.state?.targetId).toBe("A");
  await act(() => fixture.worker!.say("stop listening"));
  expect(focus.state?.targetId).toBeNull();
  await act(() => focus.output.select("hearing-aids"));
  expect(fixture.contexts[0]!.sinks.at(-1)).toBe("hearing-aids");
  await act(() => focus.stop());
  expect(fixture.worker!.terminated).toBe(true);
  expect(fixture.samples.size).toBe(0);
  expect(fixture.micStopped).toBe(false);
  expect(fixture.sockets[0]!.readyState).toBe(3);
  expect(fixture.contexts[0]!.state).toBe("closed");
});

test("a disappeared person stays lost when another face occupies their place", async () => {
  await act(() => focus.start(fixture.mic, document.createElement("video")));
  await act(() => {
    fixture.ready();
    fixture.faces();
    focus.selectAtGaze();
  });
  expect(focus.state?.targetId).toBe("A");
  await act(() => fixture.faces(["newcomer"], 1));
  expect(focus.state?.targetId).toBeNull();
  expect(focus.state?.status).toBe("TARGET_LOST");
});

test("missing calibration timing cannot silently configure a focus session", async () => {
  await act(() => focus.setVideoOffsetMs(-200));
  expect(focus.syncVerified).toBe(false);
  await act(() => focus.start(fixture.mic, document.createElement("video")));
  expect(fixture.sockets).toHaveLength(0);
  expect(focus.error).toContain("timing");
});

test("a failed service connection releases the dedicated audio output", async () => {
  fixture.failSocket();
  await act(() => focus.start(fixture.mic, document.createElement("video")));
  expect(focus.error).toContain("Invalid service URL");
  expect(fixture.contexts[0]!.state).toBe("closed");
  expect(fixture.samples.size).toBe(0);
});

test("stopping during startup closes a late session without reviving voice focus", async () => {
  fixture.holdOutput();
  let starting!: Promise<void>;
  await act(() => {
    starting = focus.start(fixture.mic, document.createElement("video"));
  });
  await act(() => focus.stop());
  try {
    expect(fixture.contexts[0]!.state).toBe("closed");
  } finally {
    await act(async () => {
      fixture.releaseOutput();
      await starting;
    });
  }
  expect(focus.active).toBe(false);
  expect(fixture.contexts[0]!.state).toBe("closed");
  expect(fixture.samples.size).toBe(0);
  expect(fixture.sockets).toHaveLength(0);
});

test("unplugging the selected speaker stops focus instead of falling back to another output", async () => {
  await act(() => focus.output.select("hearing-aids"));
  await act(() => focus.start(fixture.mic, document.createElement("video")));
  await act(() => fixture.ready());
  await act(async () => {
    fixture.disconnectOutput();
  });
  expect(focus.active).toBe(false);
  expect(focus.error).toContain("speaker disconnected");
  expect(fixture.contexts[0]!.state).toBe("closed");
});

test("changing the POV source clears audio and its timing confirmation", async () => {
  await act(() => focus.start(fixture.mic, document.createElement("video")));
  await act(() => fixture.ready());
  await act(async () => {
    fixture.changeCamera();
  });
  expect(focus.active).toBe(false);
  expect(focus.syncVerified).toBe(false);
  expect(fixture.contexts[0]!.state).toBe("closed");
});

test("timing confirmed for a previous POV source cannot configure a different camera", async () => {
  fixture.changeCamera();
  await act(() => focus.start(fixture.mic, document.createElement("video")));
  expect(fixture.sockets).toHaveLength(0);
  expect(focus.syncVerified).toBe(false);
  expect(focus.error).toContain("timing");
});

test("a rejected output closes focus before a delayed selection acknowledgement can restore it", async () => {
  await act(() => focus.start(fixture.mic, document.createElement("video")));
  await act(() => {
    fixture.ready();
    fixture.faces();
    focus.selectAtGaze();
  });
  await act(() => focus.output.select("unavailable"));
  await act(() =>
    fixture.sockets[0]!.message({
      type: "selected",
      generation: 1,
      target_id: "A",
    }),
  );
  expect(focus.active).toBe(false);
  expect(focus.error).toContain("Requested speaker rejected");
  expect(fixture.contexts[0]!.state).toBe("closed");
  expect(fixture.sockets[0]!.readyState).toBe(3);
});
