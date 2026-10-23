import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SceneCamera } from "@/features/scene-tracking/features/scene-eye-tracking/scene-camera";
import type { SceneCameraSnapshot } from "@/features/scene-tracking/features/scene-eye-tracking/scene-camera.types";
import { DEFAULT_CAMERA_TRANSFORM } from "@/features/scene-tracking/features/eye-tracking/camera-transform";
import { writeSceneSourcePreferences } from "@/features/scene-tracking/features/eye-tracking/use-camera-source-preferences";
import { useSceneMedia } from "./media";

if (typeof document === "undefined") GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let media: ReturnType<typeof useSceneMedia>;
const play = spyOn(HTMLMediaElement.prototype, "play");
const pause = spyOn(HTMLMediaElement.prototype, "pause");

function cameraFixture() {
  const listeners = new Set<() => void>();
  let state: SceneCameraSnapshot = {
    source: null,
    busy: false,
    error: "",
    devices: [],
    frame: null,
    connection: "idle",
    retryAttempt: 0,
    transform: DEFAULT_CAMERA_TRANSFORM,
  };
  const trackStop = mock(() => {});
  const stream = new MediaStream();
  Object.defineProperty(stream, "getTracks", {
    value: () => [{ stop: trackStop }],
  });
  const captureStream = mock(() => stream);
  const connected = () => {
    state = {
      ...state,
      source: {
        kind: "camera",
        key: "test",
        name: "Test camera",
        deviceId: "scene",
      },
      connection: "live",
    };
  };
  const camera = {
    latest: null as SceneCamera["latest"],
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    rawCanvas: { captureStream },
    startCamera: mock(async () => connected()),
    startNetworkStream: mock(async () => connected()),
    stop: mock(() => {
      state = { ...state, source: null, connection: "idle" };
      camera.latest = null;
      listeners.forEach((listener) => listener());
    }),
  };
  const frame = () => {
    camera.latest = {
      id: 1,
      timestamp: performance.now(),
      width: 640,
      height: 480,
      generation: 0,
    };
    listeners.forEach((listener) => listener());
  };
  return {
    camera: camera as unknown as SceneCamera,
    startCamera: camera.startCamera,
    startNetwork: camera.startNetworkStream,
    captureStream,
    trackStop,
    frame,
    listeners,
  };
}

function Harness({ camera }: { camera: SceneCamera }) {
  media = useSceneMedia(camera, "eye");
  return null;
}
beforeEach(() => {
  localStorage.clear();
  root = createRoot(document.createElement("div"));
  play.mockImplementation(async () => {});
  pause.mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => root.unmount());
});
afterAll(() => {
  play.mockRestore();
  pause.mockRestore();
});

test("concurrent lecture starts share one camera and wait for frame decoding and playback", async () => {
  const fixture = cameraFixture();
  let finishPlayback!: () => void;
  play.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishPlayback = resolve;
      }),
  );
  await act(() =>
    root.render(createElement(Harness, { camera: fixture.camera })),
  );
  let first!: Promise<HTMLVideoElement | null>;
  let second!: Promise<HTMLVideoElement | null>;
  await act(() => {
    first = media.start();
    second = media.start();
  });
  expect(first).toBe(second);
  expect(fixture.startCamera).toHaveBeenCalledTimes(1);
  expect(fixture.startCamera).toHaveBeenCalledWith("", "eye");
  expect(fixture.captureStream).not.toHaveBeenCalled();
  await act(async () => {
    fixture.frame();
    await Promise.resolve();
  });
  expect(media.error).toBeNull();
  expect(media.stream).toBeNull();
  let video: HTMLVideoElement | null = null;
  await act(async () => {
    finishPlayback();
    video = await first;
  });
  expect(video).not.toBeNull();
  expect(media.video).toBe(video);
  expect(fixture.captureStream).toHaveBeenCalledTimes(1);
  await act(() => media.stop());
  expect(fixture.trackStop).toHaveBeenCalledTimes(1);
  expect(media.stream).toBeNull();
});

test("lecture startup honors the network source saved in setup", async () => {
  const fixture = cameraFixture();
  writeSceneSourcePreferences({
    kind: "network",
    url: "http://camera.local/scene",
    deviceId: "",
  });
  await act(() =>
    root.render(createElement(Harness, { camera: fixture.camera })),
  );
  let pending!: Promise<HTMLVideoElement | null>;
  await act(() => {
    pending = media.start();
  });
  expect(fixture.startNetwork).toHaveBeenCalledWith(
    "http://camera.local/scene",
  );
  expect(fixture.startCamera).not.toHaveBeenCalled();
  await act(async () => {
    fixture.frame();
    await pending;
  });
  expect(media.error).toBeNull();
  expect(media.stream).not.toBeNull();
});

test("stopping before the first frame cancels startup without leaking a canvas stream", async () => {
  const fixture = cameraFixture();
  await act(() =>
    root.render(createElement(Harness, { camera: fixture.camera })),
  );
  let pending!: Promise<HTMLVideoElement | null>;
  await act(() => {
    pending = media.start();
  });
  let result: HTMLVideoElement | null | undefined;
  await act(async () => {
    media.stop();
    result = await pending;
  });
  expect(result).toBeNull();
  expect(fixture.captureStream).not.toHaveBeenCalled();
  expect(media.error).toBeNull();
  expect(fixture.listeners.size).toBe(1);
});
