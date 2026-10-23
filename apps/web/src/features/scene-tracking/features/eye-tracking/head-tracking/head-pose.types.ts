import type { Point, Vector3 } from "../eye-tracking.types"

export type HeadPoseMeasurement = {
  /** Original MediaPipe similarity transform in column-major order, before decomposition. */
  matrix: number[]
  scale: number
  timestamp: number
}

export type HeadPose = {
  id: number
  timestamp: number
  /** Canonical-face units, estimated by MediaPipe; these are not measured distances. */
  position: Vector3
  /** Pitch, yaw, roll in radians, after the configured input camera orientation. */
  rotation: Vector3
  /** Original measurement retained for diagnosing pose scale and synchronization. */
  measurement?: HeadPoseMeasurement
  /** Nose landmark in the oriented video, normalized to its width and height. */
  previewAnchor?: Point
}

export type HeadPoseVector = [number, number, number, number, number, number]
