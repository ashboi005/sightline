import type { Point, Vector3 } from "../eye-tracking.types"
import type { HeadPose } from "./head-pose.types"

export type HeadRayGeometry = {
  referenceDepth: number
  featureCenter: Point
  featureScale: Point
  /** Eight coefficients map normalized eye features to a head-local visual ray; its Z offset is fixed to one. */
  eyeRay: number[]
  /** All distances are relative to the reference face depth, not measured centimetres. */
  eyeOrigin: Vector3
  screenCenter: Vector3
  screenRotation: Vector3
  screenWidth: number
  screenAspectRatio: number
}

export type HeadRayMeasurement = {
  feature: Point
  pose: HeadPose
  target: Point
  weight: number
}

export type HeadPoseEnvelope = {
  minimum: number[]
  maximum: number[]
}
