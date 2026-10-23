export type ValidationPoint = [number, number]
export type ValidationViewport = { width: number; height: number }
export type ValidationReading = {
  timestamp: number
  targetId: string | number
  target: ValidationPoint
  point: ValidationPoint | null
  displayedPoint?: ValidationPoint | null
  reason?: string | null
  conditionId?: string
}
export type ValidationAccuracy = {
  meanPixels: number | null
  rmsPixels: number | null
  p95Pixels: number | null
  jitterPixels: number | null
  biasPixels: ValidationPoint | null
  attemptedCount: number
  sampleCount: number
  validFraction: number
  targetCount: number
  attemptedTargetCount: number
  rejections: Record<string, number>
}
export type ValidationTargetMetrics = ValidationAccuracy & {
  targetId: string | number
  target: ValidationPoint
}
export type ValidationConditionMetrics = ValidationAccuracy & {
  conditionId: string
}
export type ValidationMetrics = ValidationAccuracy & {
  targets: ValidationTargetMetrics[]
  conditions: ValidationConditionMetrics[]
  displayed: ValidationAccuracy | null
}
export type ScoredValidationPoint = {
  point: ValidationPoint
  error: number
  dx: number
  dy: number
}
