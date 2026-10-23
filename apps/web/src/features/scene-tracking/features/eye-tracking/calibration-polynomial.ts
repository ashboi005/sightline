import { fitScreenCoordinates } from "./calibration-least-squares"
import { fitAffineMapping, mappingValidationError } from "./calibration-mapping"
import type {
  AffineCoefficients,
  MappingPrediction,
  MappingSample,
} from "./calibration-mapping.types"
import type {
  QuadraticMapping,
  QuadraticMappingFit,
} from "./calibration-polynomial.types"
import type { Point } from "./eye-tracking.types"

const NONLINEAR_REGULARIZATION = 0.001
const MINIMUM_RELATIVE_IMPROVEMENT = 0.2
const MINIMUM_ABSOLUTE_IMPROVEMENT = 0.005

function quadraticTerms(x: number, y: number): number[] {
  return [1, x, y, x * x, x * y, y * y]
}

function fitQuadraticMapping(
  samples: MappingSample[]
): QuadraticMapping | null {
  if (samples.length < 7) {
    return null
  }
  const mean: Point = [0, 0]
  const scale: Point = [0, 0]
  const minimum: Point = [Infinity, Infinity]
  const maximum: Point = [-Infinity, -Infinity]
  for (const sample of samples) {
    if (![...sample.feature, ...sample.target].every(Number.isFinite)) {
      return null
    }
    for (let axis = 0; axis < 2; axis++) {
      mean[axis] += sample.feature[axis] / samples.length
      minimum[axis] = Math.min(minimum[axis], sample.feature[axis])
      maximum[axis] = Math.max(maximum[axis], sample.feature[axis])
    }
  }
  for (let axis = 0; axis < 2; axis++) {
    for (const sample of samples) {
      scale[axis] += (sample.feature[axis] - mean[axis]) ** 2 / samples.length
    }
    scale[axis] = Math.sqrt(scale[axis])
    if (scale[axis] < 0.002) {
      return null
    }
  }
  const rows = samples.map((sample) =>
    quadraticTerms(
      (sample.feature[0] - mean[0]) / scale[0],
      (sample.feature[1] - mean[1]) / scale[1]
    )
  )
  const targets = samples.map((sample) => sample.target)
  // Penalize curvature, not translation or linear gain. Scaling the penalty
  // by observation count keeps repeated frames from weakening regularization.
  const penalty = Math.sqrt(NONLINEAR_REGULARIZATION * samples.length)
  for (let column = 3; column < 6; column++) {
    const row = Array<number>(6).fill(0)
    row[column] = penalty
    rows.push(row)
    targets.push([0, 0])
  }
  const coefficients = fitScreenCoordinates(rows, targets)
  if (!coefficients) {
    return null
  }
  return { coefficients, mean, scale, minimum, maximum }
}

function preservesMappingDirection(
  mapping: QuadraticMapping,
  affine: AffineCoefficients
): boolean {
  const affineDeterminant =
    affine[0][1] * affine[1][2] - affine[0][2] * affine[1][1]
  if (Math.abs(affineDeterminant) < 1e-6) {
    return false
  }
  const [horizontal, vertical] = mapping.coefficients
  // Reject fits that reverse or collapse local screen motion inside the
  // calibration rectangle. A lower training error must not introduce a fold.
  for (const horizontalFraction of [0, 0.25, 0.5, 0.75, 1]) {
    for (const verticalFraction of [0, 0.25, 0.5, 0.75, 1]) {
      const featureX =
        mapping.minimum[0] +
        horizontalFraction * (mapping.maximum[0] - mapping.minimum[0])
      const featureY =
        mapping.minimum[1] +
        verticalFraction * (mapping.maximum[1] - mapping.minimum[1])
      const x = (featureX - mapping.mean[0]) / mapping.scale[0]
      const y = (featureY - mapping.mean[1]) / mapping.scale[1]
      const horizontalX =
        horizontal[1] + 2 * horizontal[3] * x + horizontal[4] * y
      const horizontalY =
        horizontal[2] + horizontal[4] * x + 2 * horizontal[5] * y
      const verticalX = vertical[1] + 2 * vertical[3] * x + vertical[4] * y
      const verticalY = vertical[2] + vertical[4] * x + 2 * vertical[5] * y
      const determinant =
        (horizontalX * verticalY - horizontalY * verticalX) /
        (mapping.scale[0] * mapping.scale[1])
      const relativeArea = determinant / affineDeterminant
      if (
        !Number.isFinite(relativeArea) ||
        relativeArea < 0.2 ||
        relativeArea > 5
      ) {
        return false
      }
    }
  }
  return true
}

export function applyQuadraticMapping(
  mapping: QuadraticMapping,
  affine: AffineCoefficients,
  feature: Point
): Point | null {
  if (!feature.every(Number.isFinite)) {
    return null
  }
  const boundary: Point = [
    Math.max(mapping.minimum[0], Math.min(mapping.maximum[0], feature[0])),
    Math.max(mapping.minimum[1], Math.min(mapping.maximum[1], feature[1])),
  ]
  const terms = quadraticTerms(
    (boundary[0] - mapping.mean[0]) / mapping.scale[0],
    (boundary[1] - mapping.mean[1]) / mapping.scale[1]
  )
  const point: Point = [0, 0]
  for (let axis = 0; axis < 2; axis++) {
    const row = mapping.coefficients[axis]
    for (let column = 0; column < terms.length; column++) {
      point[axis] += row[column] * terms[column]
    }
    // Beyond measured eye positions, keep only affine continuation. This
    // retains off-screen gaze without allowing a quadratic to grow unchecked.
    point[axis] += affine[axis][1] * (feature[0] - boundary[0])
    point[axis] += affine[axis][2] * (feature[1] - boundary[1])
  }
  if (!point.every(Number.isFinite)) {
    return null
  }
  return point
}

function fitQuadraticPrediction(
  samples: MappingSample[]
): MappingPrediction | null {
  const affine = fitAffineMapping(samples)
  const mapping = fitQuadraticMapping(samples)
  if (!affine || !mapping || !preservesMappingDirection(mapping, affine)) {
    return null
  }
  return (feature) => applyQuadraticMapping(mapping, affine, feature)
}

/** Curvature is optional and must generalize to entire unseen target holds. */
export function selectQuadraticMapping(
  samples: MappingSample[],
  affine: AffineCoefficients,
  affineError: number
): QuadraticMappingFit | null {
  const targets = new Set(samples.map((sample) => sample.target.join(",")))
  if (targets.size < 9 || affineError <= MINIMUM_ABSOLUTE_IMPROVEMENT) {
    return null
  }
  const validationError = mappingValidationError(
    samples,
    fitQuadraticPrediction
  )
  if (validationError === null) {
    return null
  }
  const improvement = affineError - validationError
  if (
    improvement < MINIMUM_ABSOLUTE_IMPROVEMENT ||
    improvement / affineError < MINIMUM_RELATIVE_IMPROVEMENT
  ) {
    return null
  }
  const mapping = fitQuadraticMapping(samples)
  if (!mapping || !preservesMappingDirection(mapping, affine)) {
    return null
  }
  return { mapping, validationError }
}
