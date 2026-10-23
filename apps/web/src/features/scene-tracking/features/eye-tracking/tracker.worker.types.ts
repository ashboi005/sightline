import type { FrameSettings, TrackingFrame } from "./eye-tracking.types"

export type WorkerRequest = {
  type: "frame"
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
  settings: FrameSettings
  id: number
  timestamp: number
  generation: number
  includePreviewMasks?: boolean
}

export type WorkerResponse =
  | { type: "ready" }
  | { type: "error"; message: string; generation?: number }
  | {
      type: "frame"
      frame: TrackingFrame
      data: Uint8ClampedArray<ArrayBuffer>
      generation: number
    }
