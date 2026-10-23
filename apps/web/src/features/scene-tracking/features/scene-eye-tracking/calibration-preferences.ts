import type { CalibrationMethod } from "./scene.types"
const KEY = "sightline.scene.calibration-method"
export function readCalibrationMethod(): CalibrationMethod {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === "marker" || saved === "one-point") {
      return saved
    }
  } catch {
    /* Storage is optional. */
  }
  return "hand"
}
export function rememberCalibrationMethod(method: CalibrationMethod) {
  try {
    localStorage.setItem(KEY, method)
  } catch {
    /* Storage is optional. */
  }
}
