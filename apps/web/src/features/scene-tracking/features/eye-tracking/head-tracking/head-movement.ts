import { relativeHeadPose } from "./head-pose"
import type { HeadPose } from "./head-pose.types"
export function isNeutralHeadPose(
  pose: HeadPose,
  reference: HeadPose
): boolean {
  const relative = relativeHeadPose(pose, reference)
  if (!relative) {
    return false
  }
  return relative.every(
    (value, axis) => Math.abs(value) < (axis < 3 ? 0.04 : 0.06)
  )
}
