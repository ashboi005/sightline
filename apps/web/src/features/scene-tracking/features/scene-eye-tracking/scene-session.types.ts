import type { Point } from "../eye-tracking/eye-tracking.types"
import type { CalibrationFitResult } from "./calibration"
import type {
  CalibrationHold,
  CalibrationMethod,
  CollectionResult,
  Collector,
  GazeMeasurement,
  SceneCalibration,
  ValidationResult,
} from "./scene.types"

export type FailedSceneCandidate = {
  calibration: SceneCalibration
  validation: ValidationResult | null
  offset: Point
  collection: CollectionResult
}

export type SceneSessionSnapshot = {
  failedCandidate?: FailedSceneCandidate | null
  method: CalibrationMethod
  calibration: SceneCalibration | null
  validation: ValidationResult | null
  capture: Collector["mode"] | null
  collection: CollectionResult | null
  notice: string
  delayMs: number
  offset: Point
  measurement: GazeMeasurement | null
  trace: GazeMeasurement[]
  fitFailure: (CalibrationFitResult & { holds: CalibrationHold[] }) | null
  reusedCalibration?: boolean
}
