import type { AffineCoefficients } from "./calibration-mapping.types"
import type { QuadraticMapping } from "./calibration-polynomial.types"
import type { Point } from "./eye-tracking.types"
import type { HeadCompensation } from "./head-tracking/head-calibration.types"
import type { HeadPose } from "./head-tracking/head-pose.types"

export type GazeOrientation = { horizontal: 1 | -1; vertical: 1 | -1 }
export type CalibrationHeadMeasurement = { feature: Point; pose: HeadPose }
export type CalibrationEyeMeasurement = {
  feature: Point
  timestamp: number
  headPose?: HeadPose
}
export type CalibrationSample = {
  feature: Point
  target: Point
  headPose?: HeadPose
  /** Paired observations let projection happen before averaging, even while the head moves. */
  headMeasurements?: CalibrationHeadMeasurement[]
  /** Individual readings are retained for honest post-fit validation, never profile storage. */
  measurements?: CalibrationEyeMeasurement[]
}
export type Calibration = {
  coefficients: AffineCoefficients
  validationError: number
  /** Selected only when withheld target holds support a nonlinear eye-only map. */
  quadraticMapping?: QuadraticMapping
  headCompensation?: HeadCompensation
}
