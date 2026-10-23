import type { Point } from "../eye-tracking/eye-tracking.types"
import type {
  SceneCalibrationProfile,
  SceneProfileSetup,
} from "./calibration-profiles.types"
import type { SceneCalibration } from "./scene.types"
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function isNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1e12
  )
}
function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(isNumber)
}
function isErrorMetric(value: unknown) {
  return value === null || (isNumber(value) && value >= 0)
}
function isTransform(value: unknown) {
  return (
    isRecord(value) &&
    isNumber(value.rotation) &&
    value.rotation >= 0 &&
    value.rotation < 360 &&
    typeof value.mirrorX === "boolean" &&
    typeof value.mirrorY === "boolean"
  )
}
function isOrientation(value: unknown) {
  return isRecord(value) && isTransform(value.eye) && isTransform(value.scene)
}
function isSetup(value: unknown): value is SceneProfileSetup {
  return (
    isRecord(value) &&
    (value.trackerFormat === "classic" || value.trackerFormat === "spatial") &&
    isOrientation(value.orientation) &&
    (value.fingerprint === undefined ||
      (typeof value.fingerprint === "string" &&
        value.fingerprint.length > 0 &&
        value.fingerprint.length <= 20000))
  )
}
function isHold(value: unknown) {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.region) ||
    !isPoint(value.feature) ||
    !isPoint(value.target)
  ) {
    return false
  }
  if (!Array.isArray(value.pairs) || value.pairs.length !== 1) {
    return false
  }
  const pair: unknown = value.pairs[0]
  if (!isRecord(pair) || !isPoint(pair.feature) || !isPoint(pair.target)) {
    return false
  }
  return (
    [pair.eyeId, pair.sceneId, pair.eyeTimestamp, pair.sceneTimestamp].every(
      isNumber
    ) &&
    isNumber(pair.width) &&
    pair.width > 0 &&
    pair.width <= 16384 &&
    isNumber(pair.height) &&
    pair.height > 0 &&
    pair.height <= 16384 &&
    typeof pair.handedness === "string"
  )
}
function isCalibration(value: unknown): value is SceneCalibration {
  if (
    !isRecord(value) ||
    !["affine", "quadratic", "projective"].includes(String(value.model))
  ) {
    return false
  }
  const coefficientCount = value.model === "quadratic" ? 6 : 3
  if (
    !Array.isArray(value.coefficients) ||
    value.coefficients.length !== 2 ||
    !value.coefficients.every(
      (row) =>
        Array.isArray(row) &&
        row.length === coefficientCount &&
        row.every(isNumber)
    )
  ) {
    return false
  }
  if (
    !isPoint(value.mean) ||
    !isPoint(value.scale) ||
    value.scale.some((scale) => scale <= 0)
  ) {
    return false
  }
  if (value.model === "projective" && !isPoint(value.denominator)) {
    return false
  }
  if (
    !isRecord(value.bounds) ||
    !isPoint(value.bounds.min) ||
    !isPoint(value.bounds.max)
  ) {
    return false
  }
  if (
    !isErrorMetric(value.crossValidationRms) ||
    !isErrorMetric(value.maxValidationError)
  ) {
    return false
  }
  if (value.trainingRms !== undefined && !isErrorMetric(value.trainingRms)) {
    return false
  }
  if (
    value.maxTrainingError !== undefined &&
    !isErrorMetric(value.maxTrainingError)
  ) {
    return false
  }
  if (
    !Array.isArray(value.holds) ||
    value.holds.length < 1 ||
    value.holds.length > 9 ||
    !value.holds.every(isHold)
  ) {
    return false
  }
  if (value.onePoint !== undefined) {
    if (
      !isRecord(value.onePoint) ||
      !["previous", "projection"].includes(String(value.onePoint.basis)) ||
      !isPoint(value.onePoint.gain)
    ) {
      return false
    }
    if (
      value.onePoint.gain.some(
        (gain) => Math.abs(gain) < 0.01 || Math.abs(gain) > 4
      )
    ) {
      return false
    }
    if (
      value.onePoint.orientation !== undefined &&
      !isOrientation(value.onePoint.orientation)
    ) {
      return false
    }
  }
  return true
}
export function isSceneCalibrationProfile(
  value: unknown
): value is SceneCalibrationProfile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 80 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 60 &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    ["hand", "marker", "one-point"].includes(String(value.method)) &&
    (value.unverified === undefined || typeof value.unverified === "boolean") &&
    isCalibration(value.calibration) &&
    isSetup(value.setup) &&
    isPoint(value.offset) &&
    value.offset.every((coordinate) => Math.abs(coordinate) <= 1) &&
    isNumber(value.delayMs) &&
    Math.abs(value.delayMs) <= 500
  )
}
