import type { SceneCamera } from "@/features/scene-tracking/features/scene-eye-tracking/scene-camera";

type FrameSource = Pick<SceneCamera, "latest" | "subscribe" | "getSnapshot">;

/** Connecting a camera does not mean its first decoded frame is available yet. */
export function waitForSceneFrame(
  camera: FrameSource,
  signal: AbortSignal,
  timeoutMs = 12_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const abort = () =>
      finish(new DOMException("Camera start cancelled.", "AbortError"));
    const inspect = () => {
      const state = camera.getSnapshot();
      if (signal.aborted) abort();
      else if (
        state.connection === "live" &&
        camera.latest &&
        performance.now() - camera.latest.timestamp <= 250
      )
        finish();
      else if (state.connection === "error" || state.connection === "idle")
        finish(
          new Error(state.error || "Connect the scene camera and try again."),
        );
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "The scene camera has not delivered a frame. Reconnect it and try again.",
          ),
        ),
      timeoutMs,
    );
    unsubscribe = camera.subscribe(inspect);
    signal.addEventListener("abort", abort, { once: true });
    inspect();
  });
}
