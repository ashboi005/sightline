import type {
  AffineCoefficients,
  MappingFitter,
  MappingPrediction,
  MappingSample,
} from "./calibration-mapping.types"
import { fitScreenCoordinates } from "./calibration-least-squares"
import type { Point } from "./eye-tracking.types"
/** Fit a small affine mapping using centered, scaled QR least squares. */
export function fitAffineMapping(
  samples: MappingSample[]
): AffineCoefficients | null {
  if (samples.length < 4) {
    return null
  }
  if (
    samples.some(
      (sample) => ![...sample.feature, ...sample.target].every(Number.isFinite)
    )
  ) {
    return null
  }
  const count = samples.length
  const mean: Point = [0, 0]
  const scale: Point = [0, 0]
  for (let axis = 0; axis < 2; axis++) {
    mean[axis] =
      samples.reduce((sum, sample) => sum + sample.feature[axis], 0) / count
    scale[axis] = Math.sqrt(
      samples.reduce(
        (sum, sample) => sum + (sample.feature[axis] - mean[axis]) ** 2,
        0
      ) / count
    )
  }
  if (scale.some((value) => value < 0.002)) {
    return null
  }
  const rows = samples.map((sample) => [
    1,
    (sample.feature[0] - mean[0]) / scale[0],
    (sample.feature[1] - mean[1]) / scale[1],
  ])
  const solution = fitScreenCoordinates(
    rows,
    samples.map((sample) => sample.target)
  )
  if (!solution) {
    return null
  }
  const coefficients: AffineCoefficients = [[], []]
  for (let axis = 0; axis < 2; axis++) {
    const values = solution[axis]
    coefficients[axis] = [
      values[0] -
        (values[1] * mean[0]) / scale[0] -
        (values[2] * mean[1]) / scale[1],
      values[1] / scale[0],
      values[2] / scale[1],
    ]
  }
  return coefficients
}
export function applyAffineMapping(
  coefficients: AffineCoefficients,
  feature: Point
): Point | null {
  const point: Point = [0, 0]
  for (let axis = 0; axis < 2; axis++) {
    const row = coefficients[axis]
    point[axis] = row[0] + row[1] * feature[0] + row[2] * feature[1]
  }
  if (!point.every(Number.isFinite)) {
    return null
  }
  return point
}
function fitAffinePrediction(
  samples: MappingSample[]
): MappingPrediction | null {
  const coefficients = fitAffineMapping(samples)
  if (!coefficients) {
    return null
  }
  return (feature) => applyAffineMapping(coefficients, feature)
}
/** Hold out each whole target, rather than adjacent frames of the same fixation. */
export function mappingValidationError(
  samples: MappingSample[],
  fit: MappingFitter = fitAffinePrediction
): number | null {
  const targets = new Set(samples.map((sample) => sample.target.join(",")))
  let squaredError = 0
  for (const target of targets) {
    const training = samples.filter(
      (sample) => sample.target.join(",") !== target
    )
    const heldOut = samples.filter(
      (sample) => sample.target.join(",") === target
    )
    const predict = fit(training)
    if (!predict) {
      return null
    }
    let targetError = 0
    for (const sample of heldOut) {
      const point = predict(sample.feature)
      if (!point) {
        return null
      }
      targetError +=
        (point[0] - sample.target[0]) ** 2 + (point[1] - sample.target[1]) ** 2
    }
    squaredError += targetError / heldOut.length
  }
  const error = Math.sqrt(squaredError / targets.size)
  if (!Number.isFinite(error)) {
    return null
  }
  return error
}
