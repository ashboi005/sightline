import type { Ellipse, Point } from "./eye-tracking.types"

export type EyeRayLine = {
  point: Point
  direction: Point
}

export type EyeCenterFit = {
  center: Point
  inliers: Ellipse[]
  residual: number
}
