import type { Point } from "../eye-tracking.types"
import type { HeadGazeModel } from "./head-gaze-model.types"
import { mapHeadPoseGaze } from "./head-pose-mapping"
import type { HeadPose } from "./head-pose.types"
import { intersectHeadRay } from "./head-ray-model"
export function projectHeadGaze(
  model: HeadGazeModel,
  eye: Point,
  pose: HeadPose,
  reference: HeadPose
): Point | null {
  if (model.method === "calibrated-pose-regression") {
    return mapHeadPoseGaze(model.mapping, eye, pose, reference)
  }
  return intersectHeadRay(model.geometry, eye, pose)
}
