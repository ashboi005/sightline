import type { CalibrationFitIssue } from "../calibration-result.types"
import type { HeadPoseMapping } from "./head-pose-mapping.types"
import type { HeadRayGeometry } from "./head-ray-model.types"

export type HeadGazeModel =
  | { method: "calibrated-ray-plane"; geometry: HeadRayGeometry }
  | { method: "calibrated-pose-regression"; mapping: HeadPoseMapping }

export type HeadGazeModelFitResult = {
  model: HeadGazeModel | null
  issue: CalibrationFitIssue | null
}
