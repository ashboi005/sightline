import type { CalibrationFitIssue } from "../calibration-result.types"
import type { HeadGazeModel } from "./head-gaze-model.types"

export type HeadModelMethod = HeadGazeModel["method"]

export type HeadModelValidationResult = {
  model: HeadGazeModel | null
  issue: CalibrationFitIssue | null
  validationError: number
  maximumValidationError: number
}
