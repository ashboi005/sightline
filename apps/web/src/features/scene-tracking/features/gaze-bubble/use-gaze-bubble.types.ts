import type { Point } from "../eye-tracking/eye-tracking.types"
import type {
  GazeBubbleOptions,
  GazeBubbleProfile,
  GazeBubbleSample,
  GazeBubbleState,
  GazeView,
} from "./gaze-bubble.types"

export type UseGazeBubbleOptions = {
  point: Point | null
  timestamp: number | null
  view: GazeView | null
  errorRadiusPx: number | null
  verified: boolean
  stabilize: boolean
  profile?: GazeBubbleProfile
  maxAgeMs?: number
  resetKey?: unknown
  offset?: Point
}
export type GazeBubbleStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => GazeBubbleState | null
  update: (
    sample: GazeBubbleSample | null,
    options: GazeBubbleOptions,
    now: number
  ) => void
}
