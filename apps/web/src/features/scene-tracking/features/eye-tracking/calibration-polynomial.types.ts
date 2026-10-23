import type { MappingCoefficients } from "./calibration-mapping.types"
import type { Point } from "./eye-tracking.types"

export type QuadraticMapping = {
  /** Coefficients act on standardized features: 1, x, y, x², xy, y². */
  coefficients: MappingCoefficients
  mean: Point
  scale: Point
  minimum: Point
  maximum: Point
}

export type QuadraticMappingFit = {
  mapping: QuadraticMapping
  validationError: number
}
