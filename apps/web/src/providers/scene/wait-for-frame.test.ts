import { expect, test } from "bun:test";
import { waitForSceneFrame } from "./wait-for-frame";
import type { SceneCamera } from "@/features/scene-tracking/features/scene-eye-tracking/scene-camera";

function source() {
  const listeners = new Set<() => void>();
  const state = { connection: "live", error: "" } as ReturnType<
    SceneCamera["getSnapshot"]
  >;
  const camera: Pick<SceneCamera, "latest" | "getSnapshot" | "subscribe"> = {
    latest: null,
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    camera,
    state,
    listeners,
    emit: () => listeners.forEach((fn) => fn()),
  };
}
test("a connected camera waits for its first decoded frame", async () => {
  const s = source();
  let done = false;
  const pending = waitForSceneFrame(
    s.camera,
    new AbortController().signal,
  ).then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  s.camera.latest = {
    id: 1,
    timestamp: performance.now(),
    width: 640,
    height: 480,
    generation: 1,
  };
  s.emit();
  await pending;
  expect(done).toBe(true);
  expect(s.listeners.size).toBe(0);
});
test("a cached frame does not count as camera startup", async () => {
  const s = source();
  s.camera.latest = {
    id: 1,
    timestamp: performance.now() - 1000,
    width: 640,
    height: 480,
    generation: 1,
  };
  const pending = waitForSceneFrame(s.camera, new AbortController().signal, 5);
  await expect(pending).rejects.toThrow(/frame/);
  expect(s.listeners.size).toBe(0);
});
test("cancellation removes listeners and rejects the pending startup", async () => {
  const s = source();
  const controller = new AbortController();
  const pending = waitForSceneFrame(s.camera, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(/cancelled/);
  expect(s.listeners.size).toBe(0);
});
