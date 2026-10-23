import type { Point } from "../eye-tracking/eye-tracking.types"
import type { CalibrationPair, SceneCalibration } from "./scene.types"

export type EvidenceIssue = { hint: string; canPause: boolean }

export type CalibrationFitResult = {
  previewCalibration?: SceneCalibration
  calibration: SceneCalibration | null
  reason: string
  retryIndex: number | null
  rms: number | null
  maximum: number | null
  pointErrors: number[]
}

export type PairInspectionResult = {
  pair: CalibrationPair | null
  issue: EvidenceIssue | null
}

export type ValidationResidual = { delta: Point; weight: number }
