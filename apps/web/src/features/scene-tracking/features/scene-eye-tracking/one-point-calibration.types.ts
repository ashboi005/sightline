import type { Point } from "../eye-tracking/eye-tracking.types"

import type { SceneCalibration } from "./scene.types"

export type OnePointCalibrationResult = {
  calibration: SceneCalibration
  offset: Point
}
