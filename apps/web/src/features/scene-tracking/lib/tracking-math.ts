import type { Point2D } from "./tracking-math.types"

/** Distance in the coordinate units of the supplied points. */
export function pointDistance(first: Point2D, second: Point2D): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}
