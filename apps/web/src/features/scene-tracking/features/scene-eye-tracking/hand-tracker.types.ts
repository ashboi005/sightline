import type { HandObservation } from "./scene.types"

export type HandTrackerSnapshot = {
  status: "idle" | "loading" | "ready" | "error"
  error: string
  hand: HandObservation | null
  previewHand: HandObservation | null
  delegate: "GPU" | "CPU" | null
  inferenceMs: number | null
}
