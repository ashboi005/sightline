import type { Point } from "../eye-tracking/eye-tracking.types"

export type CorrectionSample = { point: Point; timestamp: number }
export type CorrectionBounds = {
  left: number
  top: number
  width: number
  height: number
}
export type CorrectionResult =
  { offset: Point; error: null } | { offset: null; error: string }
export type GazeCorrectionOptions = {
  onChange: (offset: Point) => void
  initiallyActive?: boolean
  request?: number
  /** Deliberate camera pairing delay; never a replacement frame timestamp. */
  maxAgeMs?: number
}
