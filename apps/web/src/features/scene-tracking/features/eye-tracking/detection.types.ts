import type { Ellipse, Point } from "./eye-tracking.types"

export type DarkestPatch = {
  point: Point
  value: number
}

export type CvOwnedObject = {
  delete: () => void
}

export type PupilDetectionOptions = {
  thresholdMode?: "auto" | "manual"
  expectedCenter?: Point
  /** Hard anatomical bounds apply before candidate ranking and to temporal recovery. */
  maxRadius?: number
  centerRadius?: number
  /** Current visible eye opening; exclude lids, canthi and skin candidates. */
  centerRegion?: Point[]
  previous?: Ellipse | null
  previousAgeMs?: number
  previousShapeAgeMs?: number
  /** Dark interior quantile from an accepted, strongly supported full pupil. */
  pupilIntensity?: number
  /** Lower interior quantile; distinguishes pupil variation from darker lashes. */
  pupilIntensityLow?: number
  /** Full-rim exterior brightness; prevents an occluding highlight becoming a pupil edge. */
  pupilReflectionLimit?: number
  /** Periodically compare an inferred shape with independent full-ROI detection. */
  refreshShape?: boolean
  /** Last independently detected shape; limits gradual drift during rim tracking. */
  trackingAnchor?: Ellipse | null
  trackingAnchorConfirmed?: boolean
  previousSelected?: number
  includePreviewMasks?: boolean
}

export type PupilBoundaryEvidence = {
  support: number
  contrast: number
}

export type PupilRimSample = {
  point: Point
  normal: Point
  offset: number
}

export type PupilRimIdentity = {
  minimumIntensity: number
  maximumIntensity: number
  reflectionLimit: number
  reference: Ellipse
}

export type PupilProposal = {
  index: number
  points: Point[]
  refined: Point[]
  ellipse: Ellipse
  area: number
  quality: number
}

export type PupilContourRegion = {
  index: number
  area: number
  priority: number
  bounds: { x: number; y: number; width: number; height: number }
}

export type PupilCandidate = {
  shapeObserved?: boolean
  score: number
  index: number
  points: Point[]
  refined: Point[]
  ellipse: Ellipse
}

export type PupilArcEvidence = {
  persistentFraction: number
  arcCondition: number
}

export type RefinedPupilContour = {
  region: PupilContourRegion
  points: Point[]
  refined: Point[]
}
