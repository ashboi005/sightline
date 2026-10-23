import type { CameraTransform } from "../eye-tracking/camera-transform"
import type { Point } from "../eye-tracking/eye-tracking.types"

export type CameraOrientation = { eye: CameraTransform; scene: CameraTransform }

export type Landmark = { x: number; y: number; z: number }
export type CalibrationMethod = "hand" | "marker" | "one-point"
export type EyeObservation = {
  id: number
  timestamp: number
  feature: Point | null
  confidence: number
  valid: boolean
  /** A locked detector is briefly reacquiring; this frame still cannot supply gaze. */
  recoverable?: boolean
  /** Explains unusable eye evidence without mislabelling every failure as pupil loss. */
  reason?: string
}
export type SceneObservation = {
  id: number
  timestamp: number
  width: number
  height: number
  /** Native sensor dimensions, before display rotation/mirroring. */
  inputWidth?: number
  inputHeight?: number
  generation: number
}
export type ReferenceObservation = {
  scene: SceneObservation
  position: Point | null
  kind: "hand" | "marker"
  reason?: string
}
export type HandObservation = {
  scene: SceneObservation
  landmarks: Landmark[][]
  worldLandmarks: Landmark[][]
  handedness: string[]
  reason?: string
}
export type CalibrationPair = {
  eyeId: number
  sceneId: number
  eyeTimestamp: number
  sceneTimestamp: number
  feature: Point
  target: Point
  handedness: string
  width: number
  height: number
}
export type CalibrationHold = {
  region: number
  feature: Point
  target: Point
  pairs: CalibrationPair[]
}
export type Collector = {
  mode: "calibration" | "validation"
  holds: CalibrationHold[]
  pending: CalibrationPair[]
  anchor: CalibrationPair | null
  candidate: CalibrationPair | null
  lastEyeId: number
  lastSceneId: number
  lastTimestamp: number
  armed: boolean
  paused: boolean
  heldDurationMs: number
  recoveryLimitMs: number
  targetOverride: Point | null
  targets?: readonly Point[]
  automatic?: boolean
  freeTarget?: boolean
  movementSince?: number | null
}
export type CollectionResult = {
  complete: boolean
  progress: number
  hint: string
  holds: CalibrationHold[]
  armed: boolean
  canLock: boolean
  status: "waiting" | "settling" | "capturing" | "paused" | "saved"
  samples: number
  target: Point | null
}
export type SceneCalibration = {
  model: "affine" | "quadratic" | "projective"
  coefficients: [number[], number[]]
  /** Shared projective denominator 1 + dx*x + dy*y in standardized features. */
  denominator?: Point
  mean: Point
  scale: Point
  crossValidationRms: number | null
  maxValidationError: number | null
  trainingRms?: number
  maxTrainingError?: number
  method?: CalibrationMethod
  onePoint?: {
    basis: "previous" | "projection"
    gain: Point
    orientation?: CameraOrientation
  }
  bounds: { min: Point; max: Point }
  holds: CalibrationHold[]
}
export type ValidationPoint = {
  index: number
  target: Point
  position: Point
  delta: Point
  pixelDelta: Point
  normalizedError: number
  pixelError: number
}
export type ValidationResult = {
  normalizedRms: number
  pixelRms: number
  maxNormalizedError: number
  maxPixelError: number
  passed: boolean
  holds: number
  pairs: number
  offset?: Point
  points?: ValidationPoint[]
  suggestedOffset?: Point | null
  retryIndex?: number | null
}
export type GazeMeasurement = {
  timestamp: number
  eyeId: number | null
  sceneId: number | null
  eyeTimestamp: number | null
  sceneTimestamp: number | null
  confidence: number
  position: Point | null
  pixels: Point | null
  valid: boolean
  /** Fresh tracking from a one-point, reused or offset-adjusted mapping without a current accuracy check. */
  estimated?: boolean
  /** A fresh, in-frame prediction for diagnosis only; never valid recording data. */
  preview?: boolean
  reason: string
  extrapolated: boolean
}
