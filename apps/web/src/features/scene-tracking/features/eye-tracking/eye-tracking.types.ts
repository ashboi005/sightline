import type { EyeSlippage } from "./eye-slippage.types"

export type Point = [number, number]
export type Vector3 = [number, number, number]
export type TrackerFormat = "classic" | "spatial"
export type Rect = { x: number; y: number; width: number; height: number }
export type FrameDimensions = { width: number; height: number }
/** Semiaxes in pixels; angle of the MAJOR axis, in radians, image y down. */
export type Ellipse = {
  center: Point
  major: number
  minor: number
  angle: number
  confidence: number
}
export type Intrinsics = { fx: number; fy: number; cx: number; cy: number }
export type Sphere = { center: Vector3; radius: number }
export type Gaze = { origin: Vector3; direction: Vector3; pupil: Vector3 }
export type EyeModel = {
  center: Point
  radius: number
  residual: number
  samples: number
  coverage: number
  ready: boolean
}
export type ThresholdPreview = {
  label: string
  /** For rim/edge tracking, an estimated starting cutoff when switching to Manual. */
  threshold: number
  method?: "global" | "edges" | "tracking"
  mask?: Uint8Array
  score: number
}
export type Detection = {
  /** False when current arcs constrain position/scale while hidden shape remains inferred. */
  shapeObserved?: boolean
  /** Fresh image evidence sufficient for an immediate movement update at the established scale. */
  strongEvidence?: boolean
  /** Glint-excluded dark interior quantile, measured from the current full fit. */
  pupilIntensity?: number
  pupilIntensityLow?: number
  /** Glare ceiling learned only from a fresh accepted full pupil and its surroundings. */
  pupilReflectionLimit?: number
  /** A full-ROI search was performed even if a measured partial rim ultimately won. */
  fullShapeSearched?: boolean
  /** Visible feedback only; never used to fit the eye model or produce gaze. */
  candidate?: Ellipse
  tracking?: "tracking" | "reacquiring" | "lost"
  ellipse: Ellipse | null
  seed: Point | null
  contour: Point[]
  refined: Point[]
  previews: ThresholdPreview[]
  selected: number
  reason: string
}
export type FrameSettings = {
  format: TrackerFormat
  roi: Rect
  threshold: number
  thresholdMode?: "auto" | "manual"
  fov: number
  radiusMm: number
  corners: [Point, Point] | null
  locked: boolean
}
export type TrackingFrame = {
  id: number
  timestamp: number
  width: number
  height: number
  roi: Rect
  detection: Detection
  model: EyeModel | null
  gaze: Gaze | null
  slippage?: EyeSlippage
  processingMs: number
}
export type { Calibration, CalibrationSample } from "./calibration.types"
