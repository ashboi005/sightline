import type { Point } from "../eye-tracking/eye-tracking.types"
import type { GazeImageSize } from "../gaze-bubble/gaze-bubble.types"
import type { GazeCorrectionOptions } from "./gaze-correction.types"

export type GazeCorrectionLayerProps = {
  point: Point | null
  timestamp: number | null
  offset: Point
  resetKey?: unknown
  imageSize?: GazeImageSize
  options: GazeCorrectionOptions
}
