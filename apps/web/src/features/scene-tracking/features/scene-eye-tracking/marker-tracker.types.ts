import type { MarkerObservation } from "./marker-detector"

import type { SceneObservation } from "./scene.types"

export type MarkerTrackerSnapshot = {
  status: "idle" | "loading" | "ready" | "error"
  error: string
  marker: MarkerObservation | null
}

export type MarkerWorkerRequest =
  | { type: "init"; generation: number }
  | {
      type: "frame"
      generation: number
      scene: SceneObservation
      bitmap: ImageBitmap
    }

export type MarkerWorkerReply =
  | { type: "ready"; generation: number }
  | { type: "error"; generation: number; error: string }
  | { type: "result"; generation: number; marker: MarkerObservation }
