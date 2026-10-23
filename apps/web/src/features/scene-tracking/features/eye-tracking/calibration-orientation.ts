import type { GazeOrientation } from "./calibration.types"
// An upright camera facing the eye mirrors horizontal movement.
export const DEFAULT_GAZE_ORIENTATION: GazeOrientation = {
  horizontal: -1,
  vertical: 1,
}
export const SAMPLE_GAZE_ORIENTATION: GazeOrientation = {
  horizontal: 1,
  vertical: 1,
}
