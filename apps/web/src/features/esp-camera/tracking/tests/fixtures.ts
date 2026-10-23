import type { SceneCameraSnapshot } from "../../../scene-tracking/features/scene-eye-tracking/scene-camera.types"
export function liveSnapshot(): SceneCameraSnapshot {
  return {
    source: {
      kind: "camera",
      name: "Preview",
      key: "usb:preview:1",
      deviceId: "preview",
    },
    busy: false,
    error: "",
    devices: [],
    connection: "live",
    retryAttempt: 0,
    transform: { rotation: 0, mirrorX: false, mirrorY: false },
    frame: { id: 1, generation: 1, timestamp: 1000, width: 640, height: 480 },
  }
}
