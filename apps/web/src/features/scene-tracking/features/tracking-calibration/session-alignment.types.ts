import type {
  ValidationMetrics,
  ValidationPoint,
} from "./validation-metrics.types"
export type AlignmentPoint = ValidationPoint
export type AlignmentSample = {
  predicted: AlignmentPoint
  target: AlignmentPoint
  targetId: string | number
  timestamp: number
}
export type AlignmentMethod = "translation" | "affine"
export type SessionAlignment = (
  | { method: "translation"; offset: AlignmentPoint }
  | { method: "affine"; coefficients: [number[], number[]] }
) & { targetCount: number; verified: false }
export type ReturnCheckResult = {
  offset: AlignmentPoint | null
  metrics: ValidationMetrics
  corrected: boolean
  issue: string
}
export type PersonalResidualResult = {
  alignment: SessionAlignment | null
  metrics: ValidationMetrics
  issue: string
}
export type SessionAlignmentState = {
  model: object | null
  alignment: SessionAlignment | null
}
