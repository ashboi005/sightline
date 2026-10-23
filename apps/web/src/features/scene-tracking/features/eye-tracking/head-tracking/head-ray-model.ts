import type { Point, Vector3 } from "../eye-tracking.types"
import { rotateHeadVector } from "./head-geometry"
import type { HeadPose } from "./head-pose.types"
import type { HeadRayGeometry } from "./head-ray-model.types"
function dot(left: Vector3, right: Vector3): number {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0)
}
/** A single camera-coordinate ray/plane intersection is used for calibration and live gaze. */
export function intersectHeadRay(
  geometry: HeadRayGeometry,
  feature: Point,
  pose: HeadPose
): Point | null {
  if (
    ![...feature, ...pose.position, ...pose.rotation].every(Number.isFinite)
  ) {
    return null
  }
  if (pose.position[2] >= -1 || geometry.referenceDepth < 1) {
    return null
  }
  const x = (feature[0] - geometry.featureCenter[0]) / geometry.featureScale[0]
  const y = (feature[1] - geometry.featureCenter[1]) / geometry.featureScale[1]
  const matrix = geometry.eyeRay
  const ray = rotateHeadVector(
    [
      matrix[0] + matrix[1] * x + matrix[2] * y,
      matrix[3] + matrix[4] * x + matrix[5] * y,
      1 + matrix[6] * x + matrix[7] * y,
    ],
    pose.rotation
  )
  const offset = rotateHeadVector(geometry.eyeOrigin, pose.rotation)
  const origin = pose.position.map(
    (value, axis) => value / geometry.referenceDepth + offset[axis]
  ) as Vector3
  const horizontal = rotateHeadVector([1, 0, 0], geometry.screenRotation)
  const vertical = rotateHeadVector([0, 1, 0], geometry.screenRotation)
  const normal = rotateHeadVector([0, 0, 1], geometry.screenRotation)
  const denominator = dot(ray, normal)
  if (Math.abs(denominator) / Math.hypot(...ray) < 0.02) {
    return null
  }
  const difference = geometry.screenCenter.map(
    (value, axis) => value - origin[axis]
  ) as Vector3
  const distance = dot(difference, normal) / denominator
  if (distance <= 0) {
    return null
  }
  const intersection = origin.map(
    (value, axis) => value + distance * ray[axis] - geometry.screenCenter[axis]
  ) as Vector3
  const point: Point = [
    0.5 - dot(intersection, horizontal) / geometry.screenWidth,
    0.5 -
      dot(intersection, vertical) /
        (geometry.screenWidth / geometry.screenAspectRatio),
  ]
  if (!point.every(Number.isFinite)) {
    return null
  }
  return point
}
