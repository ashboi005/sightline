import type { Point } from "../eye-tracking.types"
import { relativeHeadPose } from "./head-pose"
import type {
  HeadPoseMapping,
  PoseGazeFeatures,
} from "./head-pose-mapping.types"
import type { HeadPose } from "./head-pose.types"
import type { HeadRayMeasurement } from "./head-ray-model.types"
function measuredFeatures(
  eye: Point,
  pose: HeadPose,
  reference: HeadPose
): PoseGazeFeatures | null {
  const movement = relativeHeadPose(pose, reference)
  if (!movement || !eye.every(Number.isFinite)) {
    return null
  }
  return [...eye, ...movement]
}
/** Learn eye and head gains jointly in their measured coordinates. No metric camera pose is assumed. */
export function fitHeadPoseMapping(
  readings: HeadRayMeasurement[],
  reference: HeadPose
): HeadPoseMapping | null {
  const featureCount = 8
  const columnCount = featureCount + 1
  if (readings.length < columnCount) {
    return null
  }
  const features: PoseGazeFeatures[] = []
  for (const reading of readings) {
    const feature = measuredFeatures(reading.feature, reading.pose, reference)
    if (
      !feature ||
      !reading.target.every(Number.isFinite) ||
      !Number.isFinite(reading.weight) ||
      reading.weight <= 0
    ) {
      return null
    }
    features.push(feature)
  }
  const totalWeight = readings.reduce((sum, reading) => sum + reading.weight, 0)
  const center = Array<number>(featureCount).fill(0) as PoseGazeFeatures
  const scale = Array<number>(featureCount).fill(0) as PoseGazeFeatures
  for (let axis = 0; axis < featureCount; axis++) {
    for (let row = 0; row < readings.length; row++) {
      center[axis] += (readings[row].weight * features[row][axis]) / totalWeight
    }
    for (let row = 0; row < readings.length; row++) {
      scale[axis] +=
        (readings[row].weight * (features[row][axis] - center[axis]) ** 2) /
        totalWeight
    }
    scale[axis] = Math.sqrt(scale[axis])
    if (scale[axis] < 1e-6) {
      return null
    }
  }
  const columns = [readings.map((reading) => Math.sqrt(reading.weight))]
  for (let axis = 0; axis < featureCount; axis++) {
    columns.push(
      features.map(
        (feature, row) =>
          (Math.sqrt(readings[row].weight) * (feature[axis] - center[axis])) /
          scale[axis]
      )
    )
  }
  const orthogonal: number[][] = []
  const triangular = Array.from({ length: columnCount }, () =>
    Array<number>(columnCount).fill(0)
  )
  for (let column = 0; column < columnCount; column++) {
    const values = columns[column].slice()
    // Reorthogonalization avoids forming a poorly conditioned normal-equation matrix.
    for (let pass = 0; pass < 2; pass++) {
      for (let previous = 0; previous < column; previous++) {
        const projection = values.reduce(
          (sum, value, row) => sum + value * orthogonal[previous][row],
          0
        )
        triangular[previous][column] += projection
        for (let row = 0; row < values.length; row++) {
          values[row] -= projection * orthogonal[previous][row]
        }
      }
    }
    const norm = Math.hypot(...values)
    if (norm < Math.sqrt(totalWeight) * 1e-4) {
      return null
    }
    triangular[column][column] = norm
    orthogonal.push(values.map((value) => value / norm))
  }
  const coefficients: HeadPoseMapping["coefficients"] = [[], []]
  for (let axis = 0; axis < 2; axis++) {
    const values = orthogonal.map((column) =>
      column.reduce(
        (sum, value, row) =>
          sum +
          value * Math.sqrt(readings[row].weight) * readings[row].target[axis],
        0
      )
    )
    for (let row = columnCount - 1; row >= 0; row--) {
      for (let column = row + 1; column < columnCount; column++) {
        values[row] -= triangular[row][column] * values[column]
      }
      values[row] /= triangular[row][row]
    }
    if (!values.every(Number.isFinite)) {
      return null
    }
    coefficients[axis] = values
  }
  return { center, scale, coefficients }
}
export function mapHeadPoseGaze(
  mapping: HeadPoseMapping,
  eye: Point,
  pose: HeadPose,
  reference: HeadPose
): Point | null {
  const features = measuredFeatures(eye, pose, reference)
  if (!features) {
    return null
  }
  const point: Point = [0, 0]
  for (let axis = 0; axis < 2; axis++) {
    const coefficients = mapping.coefficients[axis]
    let value = coefficients[0]
    for (let feature = 0; feature < features.length; feature++) {
      value +=
        (coefficients[feature + 1] *
          (features[feature] - mapping.center[feature])) /
        mapping.scale[feature]
    }
    point[axis] = value
  }
  if (!point.every(Number.isFinite)) {
    return null
  }
  return point
}
