import type { Calibration } from "./calibration.types"

export type CalibrationFitIssue = {
  code:
    | "screen-fit"
    | "head-samples"
    | "head-movement"
    | "head-geometry"
    | "head-validation"
  message: string
  measuredError?: number
  rank?: number
  axes?: number[]
}

export type CalibrationFitResult = {
  calibration: Calibration | null
  issue: CalibrationFitIssue | null
}
