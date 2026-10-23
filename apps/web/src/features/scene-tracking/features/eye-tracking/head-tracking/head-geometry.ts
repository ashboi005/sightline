import type { Vector3 } from "../eye-tracking.types"
import type { HeadPose } from "./head-pose.types"
/** MediaPipe pose uses Rz(roll) · Ry(yaw) · Rx(pitch), in camera coordinates. */
export function rotateHeadVector(vector: Vector3, rotation: Vector3): Vector3 {
  const [pitch, yaw, roll] = rotation
  const pitchY = Math.cos(pitch) * vector[1] - Math.sin(pitch) * vector[2]
  const pitchZ = Math.sin(pitch) * vector[1] + Math.cos(pitch) * vector[2]
  const yawX = Math.cos(yaw) * vector[0] + Math.sin(yaw) * pitchZ
  const yawZ = -Math.sin(yaw) * vector[0] + Math.cos(yaw) * pitchZ
  return [
    Math.cos(roll) * yawX - Math.sin(roll) * pitchY,
    Math.sin(roll) * yawX + Math.cos(roll) * pitchY,
    yawZ,
  ]
}
export function headForwardVector(pose: HeadPose): Vector3 | null {
  if (!pose.rotation.every(Number.isFinite)) {
    return null
  }
  return rotateHeadVector([0, 0, 1], pose.rotation)
}
