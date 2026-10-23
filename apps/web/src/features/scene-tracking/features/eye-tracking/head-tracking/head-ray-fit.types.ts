import type { CalibrationFitIssue } from "../calibration-result.types"
import type { HeadRayGeometry } from "./head-ray-model.types"

export type HeadRayFitResult = {
  geometry: HeadRayGeometry | null
  issue: CalibrationFitIssue | null
}
