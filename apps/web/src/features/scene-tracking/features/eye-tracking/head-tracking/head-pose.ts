import type { HeadPose, HeadPoseVector } from "./head-pose.types"
export const HEAD_POSE_MAX_AGE_MS = 350
export const HEAD_EYE_MAX_SKEW_MS = 25
export function readHeadPose(
  matrix: number[],
  id: number,
  timestamp: number
): HeadPose | null {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) {
    return null
  }
  if (!Number.isFinite(timestamp)) {
    return null
  }
  // MediaPipe MatrixData packs columns (not rows). Translation is the fourth column.
  const scale = Math.hypot(matrix[0], matrix[1], matrix[2])
  if (scale < 0.001 || matrix[14] >= -1) {
    return null
  }
  const columns = [0, 4, 8].map((start) =>
    matrix.slice(start, start + 3).map((value) => value / scale)
  )
  if (columns.some((column) => Math.abs(Math.hypot(...column) - 1) > 0.05)) {
    return null
  }
  for (let left = 0; left < 3; left++) {
    for (let right = left + 1; right < 3; right++) {
      const product = columns[left].reduce(
        (sum, value, axis) => sum + value * columns[right][axis],
        0
      )
      if (Math.abs(product) > 0.05) {
        return null
      }
    }
  }
  const [x, y, z] = columns
  const determinant =
    x[0] * (y[1] * z[2] - y[2] * z[1]) -
    y[0] * (x[1] * z[2] - x[2] * z[1]) +
    z[0] * (x[1] * y[2] - x[2] * y[1])
  if (
    determinant < 0.9 ||
    [matrix[3], matrix[7], matrix[11]].some(
      (value) => Math.abs(value) > 0.001
    ) ||
    Math.abs(matrix[15] - 1) > 0.001
  ) {
    return null
  }
  const pitch = Math.atan2(matrix[6], matrix[10])
  const yaw = Math.asin(Math.max(-1, Math.min(1, -matrix[2] / scale)))
  const roll = Math.atan2(matrix[1], matrix[0])
  return {
    id,
    timestamp,
    position: [matrix[12], matrix[13], matrix[14]],
    rotation: [pitch, yaw, roll],
    measurement: { matrix: [...matrix], scale, timestamp },
  }
}
function angleDifference(value: number, reference: number): number {
  const difference = value - reference
  return Math.atan2(Math.sin(difference), Math.cos(difference))
}
export function relativeHeadPose(
  pose: HeadPose,
  reference: HeadPose
): HeadPoseVector | null {
  const depth = -reference.position[2]
  const currentDepth = -pose.position[2]
  if (depth < 1 || currentDepth < 1) {
    return null
  }
  const vector: HeadPoseVector = [
    (pose.position[0] - reference.position[0]) / depth,
    (pose.position[1] - reference.position[1]) / depth,
    Math.log(currentDepth / depth),
    angleDifference(pose.rotation[0], reference.rotation[0]),
    angleDifference(pose.rotation[1], reference.rotation[1]),
    angleDifference(pose.rotation[2], reference.rotation[2]),
  ]
  if (!vector.every(Number.isFinite)) {
    return null
  }
  return vector
}
export function synchronizedHeadPose(
  pose: HeadPose | null,
  eyeTimestamp: number,
  now: number
): HeadPose | null {
  if (!pose) {
    return null
  }
  if (![pose.timestamp, eyeTimestamp, now].every(Number.isFinite)) {
    return null
  }
  const age = now - pose.timestamp
  const skew = Math.abs(pose.timestamp - eyeTimestamp)
  if (age < 0 || age > HEAD_POSE_MAX_AGE_MS || skew > HEAD_EYE_MAX_SKEW_MS) {
    return null
  }
  return pose
}
