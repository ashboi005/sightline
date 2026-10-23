import type {
  EyeModelLockStatus,
  EyeModelReadinessInput,
} from "./eye-model.types"
import type {
  Ellipse,
  EyeModel,
  FrameDimensions,
  FrameSettings,
  Point,
} from "./eye-tracking.types"
import { fitEyeCenter, minorAxisLine, outerEdgeDistance } from "./geometry"
const MINIMUM_SAMPLES = 30
const REQUIRED_COVERAGE = 0.375
const REQUIRED_DIRECTIONS = 3
const MINIMUM_MOVEMENT_RATIO = 0.035
function getMaximumResidual(width: number, height: number) {
  return Math.max(2, Math.min(width, height) * 0.015)
}
function getMaximumRadius(width: number, height: number) {
  // The ROI contains pupil movement, not the full projected eyeball.
  return Math.min(width, height) * 0.75
}
export function hasTwoDimensionalMovement(
  observations: Ellipse[],
  minimumMovement: number
) {
  const count = observations.length
  if (count < 3) {
    return false
  }
  const meanX =
    observations.reduce((sum, item) => sum + item.center[0], 0) / count
  const meanY =
    observations.reduce((sum, item) => sum + item.center[1], 0) / count
  let varianceX = 0
  let varianceY = 0
  let covariance = 0
  for (const item of observations) {
    const dx = item.center[0] - meanX
    const dy = item.center[1] - meanY
    varianceX += (dx * dx) / count
    varianceY += (dy * dy) / count
    covariance += (dx * dy) / count
  }
  // The smaller covariance eigenvalue measures spread perpendicular to the
  // main movement direction. A diagonal line must not count as a full sweep.
  const varianceDifference = Math.hypot(varianceX - varianceY, 2 * covariance)
  const perpendicularVariance = (varianceX + varianceY - varianceDifference) / 2
  return perpendicularVariance >= minimumMovement * minimumMovement
}
export function createManualEyeModel(
  corners: FrameSettings["corners"],
  width: number,
  height: number
): EyeModel | null {
  if (!corners || width <= 0 || height <= 0) {
    return null
  }
  const insideFrame = corners.every(
    ([x, y]) =>
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      x <= width &&
      y >= 0 &&
      y <= height
  )
  if (!insideFrame) {
    return null
  }
  const [first, second] = corners
  const radius = Math.hypot(first[0] - second[0], first[1] - second[1]) / 2
  if (radius <= 4) {
    return null
  }
  return {
    center: [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2],
    radius,
    residual: 0,
    samples: 2,
    coverage: 1,
    ready: true,
  }
}
export function getTrackerModelLockStatus(
  settings: FrameSettings,
  dimensions: FrameDimensions,
  model: EyeModel | null
): EyeModelLockStatus {
  if (settings.format === "classic") {
    const manualModel = createManualEyeModel(
      settings.corners,
      dimensions.width,
      dimensions.height
    )
    return {
      ready: manualModel !== null,
      blocker: manualModel ? "ready" : "corners",
      coveredDirections: 0,
      requiredDirections: 0,
      progress: manualModel ? 100 : 0,
    }
  }
  return getEyeModelLockStatus(
    model,
    dimensions.width,
    dimensions.height,
    settings.roi.width,
    settings.roi.height
  )
}
export function getEyeModelLockStatus(
  model: EyeModelReadinessInput | null,
  width: number,
  height: number,
  regionWidth = width,
  regionHeight = height
): EyeModelLockStatus {
  const minRegionDimension = Math.min(regionWidth, regionHeight)
  const coveredDirections = Math.round((model?.coverage ?? 0) * 8)
  if (!model || width <= 0 || height <= 0 || minRegionDimension <= 0) {
    return {
      ready: false,
      blocker: "waiting",
      coveredDirections,
      requiredDirections: REQUIRED_DIRECTIONS,
      progress: 0,
    }
  }
  let blocker: EyeModelLockStatus["blocker"] = "ready"
  if (!model.ready) {
    if (model.samples < MINIMUM_SAMPLES) {
      blocker = "samples"
    } else if (model.coverage < REQUIRED_COVERAGE) {
      blocker = "coverage"
    } else if (
      model.radius < minRegionDimension * 0.08 ||
      model.radius >= getMaximumRadius(width, height)
    ) {
      blocker = "radius"
    } else if (model.residual >= getMaximumResidual(width, height)) {
      blocker = "fit"
    }
  }
  const readinessProgress = Math.min(
    model.samples / MINIMUM_SAMPLES,
    coveredDirections / REQUIRED_DIRECTIONS
  )
  return {
    ready: blocker === "ready",
    blocker,
    coveredDirections,
    requiredDirections: REQUIRED_DIRECTIONS,
    progress:
      blocker === "ready"
        ? 100
        : Math.min(99, Math.round(readinessProgress * 100)),
  }
}
export class EyeModelEstimator {
  private observations: Ellipse[] = []
  private centers: Point[] = []
  private readonly coveredSectors = new Set<number>()
  private maximumRadius = 0
  private latest: EyeModel | null = null
  reset() {
    this.observations = []
    this.centers = []
    this.coveredSectors.clear()
    this.maximumRadius = 0
    this.latest = null
  }
  getLatest() {
    return this.latest
  }
  private collectMovementCoverage(inliers: Ellipse[], minimumMovement: number) {
    if (!hasTwoDimensionalMovement(inliers, minimumMovement)) {
      return
    }
    const xs = inliers.map((item) => item.center[0])
    const ys = inliers.map((item) => item.center[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const movementCenter: Point = [(minX + maxX) / 2, (minY + maxY) / 2]
    const movedHorizontally = maxX - minX >= minimumMovement * 2
    const movedVertically = maxY - minY >= minimumMovement * 2
    // An angled eye camera can place the projected sphere center outside the
    // pupil's travel. Measure coverage around that travel, not the sphere.
    for (const item of inliers) {
      const dx = movedHorizontally ? item.center[0] - movementCenter[0] : 0
      const dy = movedVertically ? item.center[1] - movementCenter[1] : 0
      if (Math.hypot(dx, dy) > minimumMovement) {
        this.coveredSectors.add(
          Math.floor(((Math.atan2(dy, dx) + Math.PI) * 4) / Math.PI) % 8
        )
      }
    }
  }
  observe(
    e: Ellipse,
    width: number,
    height: number,
    regionWidth = width,
    regionHeight = height
  ): EyeModel | null {
    if (e.confidence < 0.85 || !minorAxisLine(e)) {
      return this.latest
    }
    const previous = this.observations.at(-1)
    if (
      previous &&
      Math.hypot(
        e.center[0] - previous.center[0],
        e.center[1] - previous.center[1]
      ) < 1 &&
      Math.abs(Math.sin(e.angle - previous.angle)) < 0.04
    ) {
      return this.latest
    }
    this.observations.push(e)
    if (this.observations.length > 100) {
      this.observations.shift()
    }
    const fit = fitEyeCenter(this.observations, width, height)
    // Keep the last usable fit while a noisy observation window cannot agree.
    if (!fit || fit.residual >= getMaximumResidual(width, height)) {
      return this.latest
    }
    const fittedRadius = Math.max(
      ...fit.inliers.map((item) => outerEdgeDistance(fit.center, item))
    )
    // Do not let an early implausible fit permanently inflate the saved radius.
    if (fittedRadius >= getMaximumRadius(width, height)) {
      return this.latest
    }
    this.centers.push(fit.center)
    if (this.centers.length > 30) {
      this.centers.shift()
    }
    const center: Point = [0, 1].map(
      (axis) =>
        this.centers.reduce((s, p) => s + p[axis], 0) / this.centers.length
    ) as Point
    const minimumMovement =
      Math.min(regionWidth, regionHeight) * MINIMUM_MOVEMENT_RATIO
    this.collectMovementCoverage(fit.inliers, minimumMovement)
    const observedRadius = Math.max(
      ...fit.inliers.map((item) => outerEdgeDistance(center, item))
    )
    if (observedRadius < getMaximumRadius(width, height)) {
      this.maximumRadius = Math.max(this.maximumRadius, observedRadius)
    }
    const coverage = this.coveredSectors.size / 8
    const lockStatus = getEyeModelLockStatus(
      {
        samples: fit.inliers.length,
        coverage,
        radius: this.maximumRadius,
        residual: fit.residual,
        ready: false,
      },
      width,
      height,
      regionWidth,
      regionHeight
    )
    const ready = this.latest?.ready === true || lockStatus.ready
    this.latest = {
      center,
      radius: this.maximumRadius,
      residual: fit.residual,
      samples: fit.inliers.length,
      coverage,
      ready,
    }
    return this.latest
  }
}
