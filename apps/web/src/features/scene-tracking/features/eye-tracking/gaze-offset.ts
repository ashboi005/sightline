import type { Point } from "./eye-tracking.types"
import type { GazeOffsetAxis } from "./gaze-offset.types"
/** Apply only to mapped gaze; calibration samples remain unchanged. */
export function applyGazeOffset(
  point: Point | null,
  offset: Point
): Point | null {
  if (!point) {
    return null
  }
  return [point[0] + offset[0], point[1] + offset[1]]
}
export function offsetFromPixels(
  offset: Point,
  axis: GazeOffsetAxis,
  pixels: number,
  dimension: number
): Point {
  if (
    !Number.isFinite(pixels) ||
    !Number.isFinite(dimension) ||
    dimension <= 0
  ) {
    return offset
  }
  const next: Point = [...offset]
  next[axis] = Math.max(-1, Math.min(1, pixels / dimension))
  return next
}
