import type { Point } from "../eye-tracking/eye-tracking.types"
import type { ScreenCalibrationAnchor } from "./screen-calibration.types"

/** Shared collection order for every screen-coordinate calibration. */
export const SCREEN_CALIBRATION_TARGETS: Point[] = [
  [0.5, 0.5],
  [0.04, 0.04],
  [0.96, 0.04],
  [0.5, 0.96],
  [0.04, 0.96],
  [0.5, 0.04],
  [0.96, 0.96],
  [0.04, 0.5],
  [0.96, 0.5],
]
export const SCREEN_ACCURACY_TARGETS: Point[] = [
  [0.12, 0.12],
  [0.88, 0.12],
  [0.88, 0.88],
  [0.12, 0.88],
  [0.5, 0.5],
]

/** Accepted older grids may use another inset or order, but must cover all sectors. */
export function isScreenCalibrationGrid(targets: Point[]): boolean {
  if (
    targets.length !== SCREEN_CALIBRATION_TARGETS.length ||
    targets.some((target) => target.length !== 2) ||
    !targets[0].every((value) => value === 0.5)
  ) {
    return false
  }
  const sectors = targets.map((target) =>
    target.map((value) => Math.sign(value - 0.5)).join(",")
  )
  if (new Set(sectors).size !== targets.length) {
    return false
  }
  return targets.every(
    (target) =>
      target.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1
      ) &&
      SCREEN_CALIBRATION_TARGETS.some((expected) =>
        expected.every(
          (value, axis) =>
            Math.sign(value - 0.5) === Math.sign(target[axis] - 0.5)
        )
      )
  )
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) {
    return sorted[middle]!
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

// Allow moderate off-axis gaze without accepting an already labeled corner.
const MINIMUM_EDGE_FRACTION = 0.15
const MIDDLE_AXIS_TOLERANCE = 0.85

/** Coarse guidance from labeled holds; never proof of exact fixation or a live gaze model. */
export class ScreenCalibrationGuide {
  private readonly anchors: ScreenCalibrationAnchor[] = []
  private center: Point | null = null
  private noise: Point = [0, 0]
  private centerSampleCount = 1
  constructor(
    private readonly orientation: Point,
    private readonly minimumMovement = 0.006
  ) {}

  record(target: Point, features: Point[]): void {
    const valid = features.filter((point) => point.every(Number.isFinite))
    if (!valid.length) {
      return
    }
    const feature: Point = [
      median(valid.map((point) => point[0])),
      median(valid.map((point) => point[1])),
    ]
    const previous = this.anchors.findIndex((anchor) =>
      anchor.target.every((value, axis) => value === target[axis])
    )
    if (previous >= 0) {
      this.anchors.splice(previous, 1)
    }
    this.anchors.push({ target: [...target], feature })
    if (target.every((value) => value === 0.5)) {
      this.center = feature
      this.centerSampleCount = valid.length
      this.noise = [0, 1].map(
        (axis) =>
          1.4826 *
          median(valid.map((point) => Math.abs(point[axis] - feature[axis])))
      ) as Point
    }
  }

  private span(
    axis: number,
    side: number,
    fallbackToOpposite: boolean
  ): number {
    let sameSide = 0
    let opposite = 0
    for (const anchor of this.anchors) {
      const direction = Math.sign(anchor.target[axis] - 0.5)
      if (!direction) {
        continue
      }
      const displacement = Math.abs(anchor.feature[axis] - this.center![axis])
      if (direction === side) {
        sameSide = Math.max(sameSide, displacement)
      } else {
        opposite = Math.max(opposite, displacement)
      }
    }
    // An unmeasured direction has no known gain. The opposite side can only
    // supply a broad middle-band estimate, not a minimum movement requirement.
    if (sameSide > 0 || !fallbackToOpposite) {
      return sameSide
    }
    return opposite
  }

  /** Reject a contradictory frame without treating it as a full fixation estimate. */
  contradicts(feature: Point, target: Point): boolean {
    if (!feature.every(Number.isFinite) || !target.every(Number.isFinite)) {
      return true
    }
    if (!this.center || target.every((value) => value === 0.5)) {
      return false
    }
    return feature.some((value, axis) => {
      const movement = (value - this.center![axis]) * this.orientation[axis]
      const expected = Math.sign(target[axis] - 0.5)
      const span = this.span(axis, expected || Math.sign(movement), true)
      const uncertainty = Math.max(this.minimumMovement, this.noise[axis] * 2.5)
      if (expected) {
        return (
          movement * expected <
          -Math.max(uncertainty, span * MINIMUM_EDGE_FRACTION)
        )
      }
      if (span > 0) {
        return Math.abs(movement) > span * MIDDLE_AXIS_TOLERANCE + uncertainty
      }
      return Math.abs(movement) > uncertainty * 2
    })
  }

  matches(feature: Point, target: Point, observationCount?: number): boolean {
    if (![...feature, ...target].every(Number.isFinite)) {
      return false
    }
    if (!this.center || target.every((value) => value === 0.5)) {
      return true
    }
    for (let axis = 0; axis < 2; axis++) {
      const movement =
        (feature[axis] - this.center[axis]) * this.orientation[axis]
      const expected = Math.sign(target[axis] - 0.5)
      const span = this.span(
        axis,
        expected || Math.sign(movement),
        expected === 0
      )
      let uncertainty = this.noise[axis]
      if (observationCount !== undefined) {
        if (!Number.isFinite(observationCount) || observationCount < 1) {
          return false
        }
        // Compare two location estimates, not a steady hold against the noise
        // of one center frame. Existing single-frame guides retain their rule.
        uncertainty *= Math.sqrt(
          1 / this.centerSampleCount + 1 / Math.min(observationCount, 32)
        )
      }
      const minimum = Math.max(this.minimumMovement, uncertainty * 2.5)
      if (expected) {
        if (
          movement * expected <
          Math.max(minimum, span * MINIMUM_EDGE_FRACTION)
        ) {
          return false
        }
      } else {
        let tolerance = minimum * 2
        if (span > 0) {
          tolerance = span * MIDDLE_AXIS_TOLERANCE
        }
        if (Math.abs(movement) > tolerance) {
          return false
        }
      }
    }
    return true
  }
}
