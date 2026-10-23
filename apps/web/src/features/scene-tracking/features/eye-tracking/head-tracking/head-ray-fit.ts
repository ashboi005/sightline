import { applyAffineMapping, fitAffineMapping } from "../calibration-mapping"
import type { CalibrationSample } from "../calibration.types"
import type { Point, Vector3 } from "../eye-tracking.types"
import { rotateHeadVector } from "./head-geometry"
import { isNeutralHeadPose } from "./head-movement"
import type { HeadPose } from "./head-pose.types"
import type { HeadRayFitResult } from "./head-ray-fit.types"
import { intersectHeadRay } from "./head-ray-model"
import type {
  HeadRayGeometry,
  HeadRayMeasurement,
} from "./head-ray-model.types"
import { fitNonlinearModel } from "./nonlinear-fit"
import type { ParameterBounds } from "./nonlinear-fit.types"
export const HEAD_RAY_PARAMETER_COUNT = 18
const PARAMETER_BOUNDS: ParameterBounds = {
  minimum: [
    ...Array<number>(8).fill(-10),
    ...Array<number>(3).fill(-0.3),
    -1,
    -1,
    -0.5,
    -Math.PI,
    -Math.PI,
    -Math.PI,
    Math.log(0.15),
  ],
  maximum: [
    ...Array<number>(8).fill(10),
    ...Array<number>(3).fill(0.3),
    1,
    1,
    0.5,
    Math.PI,
    Math.PI,
    Math.PI,
    Math.log(2),
  ],
}
function geometryFromParameters(
  base: HeadRayGeometry,
  parameters: number[]
): HeadRayGeometry {
  return {
    ...base,
    eyeRay: parameters.slice(0, 8),
    eyeOrigin: parameters.slice(8, 11) as Vector3,
    screenCenter: parameters.slice(11, 14) as Vector3,
    screenRotation: parameters.slice(14, 17) as Vector3,
    screenWidth: Math.exp(parameters[17]),
  }
}
function initialGeometry(
  samples: CalibrationSample[],
  reference: HeadPose,
  aspect: number,
  width: number,
  screenRotation: Vector3
): HeadRayGeometry | null {
  const neutral = samples
    .filter(
      (sample) =>
        sample.headPose && isNeutralHeadPose(sample.headPose, reference)
    )
    .slice(0, 9)
  if (neutral.length < 4) {
    return null
  }
  const featureCenter: Point = [0, 0]
  const featureScale: Point = [0, 0]
  for (let axis = 0; axis < 2; axis++) {
    featureCenter[axis] = neutral.reduce(
      (sum, sample) => sum + sample.feature[axis] / neutral.length,
      0
    )
    featureScale[axis] = Math.sqrt(
      neutral.reduce(
        (sum, sample) =>
          sum +
          (sample.feature[axis] - featureCenter[axis]) ** 2 / neutral.length,
        0
      )
    )
  }
  if (featureScale.some((value) => value < 0.002)) {
    return null
  }
  const mapping = fitAffineMapping(
    neutral.map((sample) => ({
      target: sample.target,
      feature: sample.feature.map(
        (value, axis) => (value - featureCenter[axis]) / featureScale[axis]
      ) as Point,
    }))
  )
  if (!mapping) {
    return null
  }
  // Back-project the neutral grid only as a starting estimate. Motion data determines the geometry.
  const depth = -reference.position[2]
  const translation = reference.position.map(
    (value) => value / depth
  ) as Vector3
  const screenColumns: Vector3[] = [
    [
      (0.5 - mapping[0][0]) * width,
      ((0.5 - mapping[1][0]) * width) / aspect,
      0,
    ],
    [-mapping[0][1] * width, (-mapping[1][1] * width) / aspect, 0],
    [-mapping[0][2] * width, (-mapping[1][2] * width) / aspect, 0],
  ]
  const cameraColumns = screenColumns.map((column) =>
    rotateHeadVector(column, screenRotation)
  )
  const center: Vector3 = [0, -0.1, 0]
  cameraColumns[0] = cameraColumns[0].map(
    (value, axis) => value + center[axis] - translation[axis]
  ) as Vector3
  const basis = [
    rotateHeadVector([1, 0, 0], reference.rotation),
    rotateHeadVector([0, 1, 0], reference.rotation),
    rotateHeadVector([0, 0, 1], reference.rotation),
  ]
  const local = cameraColumns.map((column) =>
    basis.map((axis) =>
      axis.reduce((sum, value, index) => sum + value * column[index], 0)
    )
  )
  const denominator = local[0][2]
  if (denominator <= 0.1) {
    return null
  }
  return {
    referenceDepth: depth,
    featureCenter,
    featureScale,
    eyeRay: [
      local[0][0],
      local[1][0],
      local[2][0],
      local[0][1],
      local[1][1],
      local[2][1],
      local[1][2],
      local[2][2],
    ].map((value) => value / denominator),
    eyeOrigin: [0, 0, 0],
    screenCenter: [0, -0.1, 0],
    screenRotation,
    screenWidth: width,
    screenAspectRatio: aspect,
  }
}
export function fitHeadRayGeometryWithDiagnostics(
  samples: CalibrationSample[],
  readings: HeadRayMeasurement[],
  reference: HeadPose,
  aspect: number
): HeadRayFitResult {
  let best: HeadRayGeometry | null = null
  let bestError = Infinity
  let bestRank = 0
  const rotations = initialScreenOrientations(samples, reference)
  for (const screenRotation of rotations) {
    const base = initialGeometry(
      samples,
      reference,
      aspect,
      0.65,
      screenRotation
    )
    if (!base) {
      continue
    }
    const initial = [
      ...base.eyeRay,
      ...base.eyeOrigin,
      ...base.screenCenter,
      ...base.screenRotation,
      Math.log(base.screenWidth),
    ]
    const result = fitNonlinearModel(
      initial,
      PARAMETER_BOUNDS,
      (parameters) => {
        const geometry = geometryFromParameters(base, parameters)
        const residuals: number[] = []
        for (const reading of readings) {
          const point = intersectHeadRay(
            geometry,
            reading.feature,
            reading.pose
          )
          if (!point) {
            return null
          }
          const weight = Math.sqrt(reading.weight)
          residuals.push(
            weight * (point[0] - reading.target[0]),
            weight * (point[1] - reading.target[1])
          )
        }
        return residuals
      }
    )
    if (!result) {
      continue
    }
    bestRank = Math.max(bestRank, result.rank)
    if (result.rank !== HEAD_RAY_PARAMETER_COUNT) {
      continue
    }
    const error = result.error * Math.sqrt(readings.length / samples.length)
    if (error >= bestError) {
      continue
    }
    best = geometryFromParameters(base, result.parameters)
    bestError = error
    if (error < 0.005) {
      break
    }
  }
  if (!best) {
    return {
      geometry: null,
      issue: {
        code: "head-geometry",
        rank: bestRank,
        message:
          "Head movement did not establish a usable camera geometry. Repeat the head pass while looking at the center dot.",
      },
    }
  }
  if (bestError > 0.03) {
    return {
      geometry: null,
      issue: {
        code: "head-geometry",
        measuredError: bestError,
        message: `Head and eye readings disagreed (${(bestError * 100).toFixed(1)}% screen error). Repeat just the head movements.`,
      },
    }
  }
  return { geometry: best, issue: null }
}
export function fitHeadRayGeometry(
  samples: CalibrationSample[],
  readings: HeadRayMeasurement[],
  reference: HeadPose,
  aspect: number
): HeadRayGeometry | null {
  return fitHeadRayGeometryWithDiagnostics(samples, readings, reference, aspect)
    .geometry
}
/** Pure translation holds reveal which screen axes an input mirror reverses.
 * This only orders optimizer starts. The fit and independent holdouts still decide acceptance. */
function initialScreenOrientations(
  samples: CalibrationSample[],
  reference: HeadPose
): Vector3[] {
  const rotations: Vector3[] = [
    [0, 0, 0],
    [0, Math.PI, 0],
    [Math.PI, 0, 0],
    [0, 0, Math.PI],
  ]
  const neutral = samples.filter(
    (sample) => sample.headPose && isNeutralHeadPose(sample.headPose, reference)
  )
  const mapping = fitAffineMapping(neutral)
  if (!mapping) {
    return rotations
  }
  const covariance: Point = [0, 0]
  for (const sample of samples) {
    const pose = sample.headPose
    if (
      !pose ||
      pose.rotation.some(
        (value, axis) => Math.abs(value - reference.rotation[axis]) > 0.04
      )
    ) {
      continue
    }
    const point = applyAffineMapping(mapping, sample.feature)
    if (!point) {
      continue
    }
    for (let axis = 0; axis < 2; axis++) {
      covariance[axis] +=
        (point[axis] - sample.target[axis]) *
        (pose.position[axis] - reference.position[axis])
    }
  }
  let preferred = 0
  if (covariance[0] < 0) {
    preferred += 1
  }
  if (covariance[1] < 0) {
    preferred += 2
  }
  return [
    rotations[preferred],
    ...rotations.filter((_, index) => index !== preferred),
  ]
}
