import { DEFAULT_CAMERA_TRANSFORM } from "../eye-tracking/camera-transform"
import type { Point } from "../eye-tracking/eye-tracking.types"
import { mapSceneGaze } from "./calibration"
import type { OnePointCalibrationResult } from "./one-point-calibration.types"
import type {
  CalibrationHold,
  CameraOrientation,
  SceneCalibration,
} from "./scene.types"
export function fitOnePointCalibration(
  hold: CalibrationHold,
  previous: SceneCalibration | null,
  gain?: Point,
  orientation: CameraOrientation = {
    eye: DEFAULT_CAMERA_TRANSFORM,
    scene: DEFAULT_CAMERA_TRANSFORM,
  }
): OnePointCalibrationResult | null {
  const pair = hold.pairs[0]
  if (
    !pair ||
    pair.width <= 0 ||
    pair.height <= 0 ||
    [...hold.feature, ...hold.target, pair.width, pair.height].some(
      (v) => !Number.isFinite(v)
    )
  ) {
    return null
  }
  const gains: Point = gain ?? [0.5, (0.5 * pair.width) / pair.height]
  if (
    gains.some(
      (v) => !Number.isFinite(v) || Math.abs(v) < 0.01 || Math.abs(v) > 4
    )
  ) {
    return null
  }
  const mapped = previous && mapSceneGaze(previous, hold.feature)
  if (previous && mapped) {
    return {
      calibration: {
        ...previous,
        method: "one-point",
        onePoint: { basis: "previous", gain: gains, orientation },
        holds: [hold],
      },
      offset: [hold.target[0] - mapped[0], hold.target[1] - mapped[1]],
    }
  }
  // A nominal 90° horizontal pinhole projection supplies a shape, not a
  // measured camera-to-eye alignment. One fixation measures only translation.
  // Both inputs already use the user's corrected views. A front-facing eye
  // camera sees wearer-right as image-left, whereas the outward scene sees
  // wearer-right as image-right. Vertical image directions agree. Do not undo
  // or reapply camera adjustments here; orientation is setup metadata only.
  return {
    calibration: {
      model: "affine",
      method: "one-point",
      onePoint: { basis: "projection", gain: gains, orientation },
      mean: [...hold.feature],
      scale: [1, 1],
      coefficients: [
        [hold.target[0], -gains[0], 0],
        [hold.target[1], 0, gains[1]],
      ],
      crossValidationRms: null,
      maxValidationError: null,
      bounds: { min: [...hold.target], max: [...hold.target] },
      holds: [hold],
    },
    offset: [0, 0],
  }
}
