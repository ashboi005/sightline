import type { SceneCamera } from "../../scene-tracking/features/scene-eye-tracking/scene-camera"

/** The existing scene controller and an independent ESP camera both supply these pixels. */
export type ViewerCamera = Pick<SceneCamera, "rawCanvas" | "getSnapshot" | "subscribe">
