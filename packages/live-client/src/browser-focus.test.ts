import { expect, test } from "bun:test";
import { FocusedAudioPlayer, startFrameGrabber, startLookToHear } from "./browser";

function audioContext(sink = true) {
  const outputs: string[] = [];
  const nodes: { stopped: boolean }[] = [];
  const buffers: number[][] = [];
  const context = {
    state: "running",
    async resume() {},
    async close() {},
    currentTime: 0,
    destination: {},
    ...(sink
      ? {
          setSinkId: async (id: string) => {
            outputs.push(id);
          },
        }
      : {}),
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: {
        cancelScheduledValues() {},
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      },
    }),
    createBuffer: () => ({
      copyToChannel(pcm: Float32Array) {
        buffers.push([...pcm]);
      },
    }),
    createBufferSource: () => {
      const node = {
        stopped: false,
        connect() {},
        start() {},
        stop() {
          this.stopped = true;
        },
      };
      nodes.push(node);
      return node;
    },
  } as unknown as AudioContext;
  return { context, outputs, nodes, buffers };
}

test("focused playback copies only the unplayed samples of overlapping chunks", () => {
  const fixture = audioContext();
  const player = new FocusedAudioPlayer(fixture.context);
  player.play(new Float32Array([0.1, 0.2, 0.3]), 100, 1);
  player.play(new Float32Array([0.1, 0.2, 0.3]), 100, 1);
  player.play(new Float32Array([0.3, 0.4, 0.5]), 102, 1);
  expect(fixture.buffers.map((buffer) => buffer.map((sample) => Math.round(sample * 10))))
    .toEqual([[1, 2, 3], [4, 5]]);
  expect(fixture.nodes).toHaveLength(2);
  player.stop();
});

test("selecting a person keeps a recent scene frame already being encoded", async () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
  let now = 1000;
  let encode!: (blob: Blob) => void;
  let frameTick!: () => void;
  let receiveMic!: (samples: Float32Array) => void;
  let socket!: Socket;
  const fixture = audioContext();
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toBlob(callback: (blob: Blob) => void) { encode = callback; },
  };
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor() { socket = this; }
    send(data: unknown) { this.sent.push(data); }
    close() {}
    message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  for (const [name, value] of Object.entries({
    AudioContext: function () { return fixture.context; },
    WebSocket: Socket,
    document: { createElement: () => canvas },
    setInterval: (callback: () => void, interval: number) => {
      if (interval < 100) frameTick = callback;
      return 1;
    },
    clearInterval() {},
  })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  let session: Awaited<ReturnType<typeof startLookToHear>> | undefined;
  try {
    session = await startLookToHear({
      mic: {
        context: fixture.context,
        subscribe(listener) { receiveMic = listener; return () => {}; },
        async stop() {},
      },
      sceneVideo: {} as HTMLVideoElement,
      speakerUrl: "ws://127.0.0.1:7799/live",
      readFrame: () => ({
        key: "frame-1", image: canvas as unknown as HTMLCanvasElement,
        width: 640, height: 480, capturedAt: 1290,
      }),
    });
    socket.readyState = 1;
    socket.onopen?.();
    socket.message({
      type: "ready", generation: 0, device: "cpu", protocol_version: 3,
      analysis_mode: "available", engine: "rtfs", minimum_samples: 1920,
      history_samples: 6400, maximum_input_samples: 128000,
      noise_processor: "off", warm_timings: [],
    });
    now = 1312.5;
    receiveMic(new Float32Array(5000));
    socket.message({
      type: "faces", generation: 0,
      tracks: [{ id: "A", manual: false, observations: [{ timestamp: 0.3, box: [0.1, 0.2, 0.2, 0.3] }] }],
    });
    now = 1330;
    frameTick();
    now = 1340;
    expect(session.select("A").ok).toBe(true);
    now = 1370;
    encode(new Blob([new Uint8Array([1])]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frames = socket.sent.filter((packet): packet is ArrayBuffer => packet instanceof ArrayBuffer);
    expect(frames).toHaveLength(1);
    const header = new DataView(frames[0]!);
    expect(header.getUint32(8, true)).toBe(1);
    expect(Number(header.getBigUint64(12, true))).toBe(4640);
    expect(header.getFloat64(20, true)).toBe(1.29);
  } finally {
    await session?.stop();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    if (originalNow) Object.defineProperty(performance, "now", originalNow);
    else Reflect.deleteProperty(performance, "now");
  }
});

test("focused audio uses the selected speaker and cancels queued audio on a target reset", async () => {
  const fixture = audioContext();
  const player = new FocusedAudioPlayer(fixture.context);
  await player.setOutputDevice("hearing-aids");
  expect(fixture.outputs).toEqual(["hearing-aids"]);
  player.play(new Float32Array([0.2]), 0, 1);
  player.reset(2);
  expect(fixture.nodes[0]!.stopped).toBe(true);
  player.play(new Float32Array([0.2]), 0, 1);
  expect(fixture.nodes).toHaveLength(1);
  player.play(new Float32Array([0.2]), 0, 2);
  expect(fixture.nodes).toHaveLength(2);
  player.stop();
});

test("unsupported speaker routing rejects a chosen device instead of silently playing elsewhere", async () => {
  const fixture = audioContext(false);
  const player = new FocusedAudioPlayer(fixture.context);
  await expect(player.setOutputDevice("hearing-aids")).rejects.toThrow(
    "output",
  );
  await player.setOutputDevice("");
  player.stop();
});

test("switching outputs stops queued speech before awaiting device permission", async () => {
  const fixture = audioContext();
  const player = new FocusedAudioPlayer(fixture.context);
  player.play(new Float32Array([0.2]), 0, 1);
  const switching = player.setOutputDevice("headphones");
  expect(fixture.nodes[0]!.stopped).toBe(true);
  await switching;
  player.stop();
});

test("network frame capture sends each decoded frame once and cancels a late JPEG after stop", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let tick!: () => void;
  let encode!: (blob: Blob) => void;
  let draws = 0;
  let frame = 1;
  let portrait = false;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage() {
        draws++;
      },
    }),
    toBlob(callback: (blob: Blob) => void) {
      encode = callback;
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => canvas },
  });
  globalThis.setInterval = ((callback: () => void) => {
    tick = callback;
    return 1;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  const received: Uint8Array[] = [];
  const grabber = startFrameGrabber(
    { readyState: 2, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement,
    (jpeg) => received.push(jpeg),
    {
      readFrame: () => ({
        key: String(frame),
        image: canvas as unknown as HTMLCanvasElement,
        width: portrait ? 480 : 640,
        height: portrait ? 640 : 480,
        capturedAt: performance.now(),
      }),
    },
  );
  try {
    tick();
    encode(new Blob([new Uint8Array([1])]));
    await new Promise((r) => setTimeout(r, 0));
    tick();
    expect(draws).toBe(1);
    expect(received).toHaveLength(1);
    frame++;
    portrait = true;
    tick();
    expect(draws).toBe(2);
    expect(canvas.height).toBeLessThanOrEqual(480);
    expect(canvas.width / canvas.height).toBe(480 / 640);
    grabber.stop();
    encode(new Blob([new Uint8Array([2])]));
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toHaveLength(1);
  } finally {
    grabber.stop();
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("frame capture keeps every distinct frame of a 25 fps camera", async () => {
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
  let tick!: () => void;
  let interval = 0;
  let now = 0;
  let key = 0;
  const received: number[] = [];
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toBlob(callback: (blob: Blob) => void) {
      callback(new Blob([new Uint8Array([key])]));
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true, value: { createElement: () => canvas },
  });
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  globalThis.setInterval = ((callback: () => void, delay: number) => {
    tick = callback;
    interval = delay;
    return 1;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  const grabber = startFrameGrabber({} as HTMLVideoElement, (jpeg) => received.push(jpeg[0]!), {
    readFrame: () => ({
      key: String(key), image: canvas as unknown as HTMLCanvasElement,
      width: 640, height: 480, capturedAt: now,
    }),
  });
  try {
    let nextPoll = interval;
    for (key = 1; key <= 5; key++) {
      now = key * 40;
      while (now >= nextPoll) {
        tick();
        nextPoll += interval;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    expect(received).toEqual([1, 2, 3, 4, 5]);
    key = 5;
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([1, 2, 3, 4, 5]);
  } finally {
    grabber.stop();
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalNow) Object.defineProperty(performance, "now", originalNow);
    else Reflect.deleteProperty(performance, "now");
  }
});
