import type { GazeCorrectionOptions } from "../gaze-correction/gaze-correction.types"
import type { Point } from "../eye-tracking/eye-tracking.types"
import type { MutableRefObject } from "react"
import type {
  GazeBubbleState,
  GazeBubbleProfile,
  GazeImageSize,
  GazeView,
} from "./gaze-bubble.types"

export type GazeBubbleOverlaySnapshot = {
  bubble: GazeBubbleState
  view: GazeView
  showUncertainty?: boolean
}

export type GazeBubbleOverlayProps = {
  correction?: GazeCorrectionOptions
  point: Point | null
  timestamp: number | null
  errorRadiusPx?: number | null
  /** Presentation only; measured error and raw gaze remain available. */
  showUncertainty?: boolean
  verified?: boolean
  resetKey?: unknown
  offset?: Point
  fixed?: boolean
  stabilize?: boolean
  profile?: GazeBubbleProfile
  maxAgeMs?: number
  /** Native image dimensions; errorRadiusPx is then in native image pixels. */
  imageSize?: GazeImageSize
  markerClassName?: string
  snapshotRef?: MutableRefObject<GazeBubbleOverlaySnapshot | null>
}
