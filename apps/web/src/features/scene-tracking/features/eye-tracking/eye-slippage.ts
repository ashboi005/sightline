import { pointDistance } from "@/features/scene-tracking/lib/tracking-math"
import { hasTwoDimensionalMovement } from "./eye-model"
import type {
  EyeSlippage,
  EyeSlippageContext,
  EyeSlippageFit,
  EyeSlippageObservation,
} from "./eye-slippage.types"
import type { Detection, Ellipse, Point } from "./eye-tracking.types"
import { fitEyeCenter, minorAxisLine } from "./geometry"

const MIN_SAMPLES = 24
const MAX_SAMPLES = 48
const WINDOW_MS = 2500
const MIN_SAMPLE_INTERVAL_MS = 30

function hasIndependentAxes(ellipses: Ellipse[]): boolean {
  let xx = 0
  let xy = 0
  let yy = 0
  for (const ellipse of ellipses) {
    const x = Math.cos(ellipse.angle)
    const y = Math.sin(ellipse.angle)
    xx += x * x
    xy += x * y
    yy += y * y
  }
  // Near-parallel minor-axis lines can agree on residual while their
  // intersection is arbitrarily far away. Require angular conditioning too.
  return xx * yy - xy * xy >= 0.04 * (xx + yy) ** 2
}

function confirmFit(
  current: EyeSlippageFit,
  previous: EyeSlippageFit | null
): EyeSlippageFit | null {
  if (
    !previous ||
    current.timestamp - previous.timestamp > WINDOW_MS ||
    pointDistance(current.center, previous.center) >
      Math.max(1, current.residual + previous.residual)
  ) {
    return null
  }
  return {
    ...current,
    center: [
      (current.center[0] + previous.center[0]) / 2,
      (current.center[1] + previous.center[1]) / 2,
    ],
    residual: Math.max(current.residual, previous.residual),
  }
}

/**
 * Estimate bounded image-plane translation from diverse, observed pupil shapes.
 * Under weak perspective, rotating pupil minor axes meet at the projected eye
 * center. This compensates translation only: no depth, camera rotation, corneal
 * refraction, or general 3D slippage is recovered. Locked eye geometry never drifts.
 */
export class EyeSlippageTracker {
  private observations: EyeSlippageObservation[] = []
  private latestFit: EyeSlippageFit | null = null
  private baselineCandidate: EyeSlippageFit | null = null
  private eligibleBaseline: EyeSlippageFit | null = null
  private baseline: EyeSlippageFit | null = null
  private pending: EyeSlippageFit | null = null
  private offset: Point = [0, 0]
  private status: EyeSlippage["status"] = "collecting"
  private locked = false
  private lastTimestamp = -Infinity
  private lastSampleTimestamp = -Infinity
  private fitCountdown = 0

  reset(): void {
    this.observations = []
    this.latestFit = null
    this.baselineCandidate = null
    this.eligibleBaseline = null
    this.baseline = null
    this.pending = null
    this.offset = [0, 0]
    this.status = "collecting"
    this.locked = false
    this.lastTimestamp = -Infinity
    this.lastSampleTimestamp = -Infinity
    this.fitCountdown = 0
  }

  private snapshot(): EyeSlippage {
    return {
      status: this.status,
      offset: [...this.offset],
      samples: this.observations.length,
      residual: this.latestFit?.residual ?? null,
    }
  }

  private clearWindow(): void {
    this.observations = []
    this.fitCountdown = 0
  }

  private acceptFit(fit: EyeSlippageFit, context: EyeSlippageContext): void {
    this.latestFit = fit
    // Clearing after a usable fit makes confirmation windows independent.
    this.clearWindow()
    if (!context.locked || !this.baseline) {
      // A single plausible fit is telemetry, never a usable lock reference.
      // A conflicting new fit also revokes an older pre-lock confirmation.
      this.eligibleBaseline = confirmFit(fit, this.baselineCandidate)
      this.baselineCandidate = fit
      this.status = "collecting"
      if (context.locked && this.eligibleBaseline) {
        this.baseline = this.eligibleBaseline
        this.eligibleBaseline = null
        this.baselineCandidate = null
        this.status = "stable"
      }
      return
    }
    const translation: Point = [
      fit.center[0] - this.baseline.center[0],
      fit.center[1] - this.baseline.center[1],
    ]
    const maximumTranslation = Math.min(
      (context.model?.radius ?? 0) * 0.25,
      Math.min(context.roi.width, context.roi.height) * 0.15
    )
    if (
      !context.model?.ready ||
      Math.hypot(...translation) > maximumTranslation
    ) {
      this.pending = null
      this.status = "limited"
      return
    }
    const noiseFloor = Math.max(
      1.5,
      2 * (fit.residual + this.baseline.residual)
    )
    if (pointDistance(translation, this.offset) <= noiseFloor) {
      this.pending = null
      this.status = Math.hypot(...this.offset) > 0 ? "compensated" : "stable"
      return
    }
    const confirmed = confirmFit(fit, this.pending)
    if (!confirmed) {
      this.pending = fit
      this.status = "limited"
      return
    }
    this.offset = [
      confirmed.center[0] - this.baseline.center[0],
      confirmed.center[1] - this.baseline.center[1],
    ]
    // Numerical roundoff at the unchanged baseline is not a measured shift.
    if (Math.hypot(...this.offset) <= noiseFloor) {
      this.offset = [0, 0]
    }
    this.pending = null
    this.status = Math.hypot(...this.offset) > 0 ? "compensated" : "stable"
  }

  observe(detection: Detection, context: EyeSlippageContext): EyeSlippage {
    const { locked, timestamp, width, height, roi } = context
    if (this.locked && !locked) {
      this.reset()
    }
    if (locked && !this.locked) {
      const recent =
        this.eligibleBaseline &&
        timestamp >= this.eligibleBaseline.timestamp &&
        timestamp - this.eligibleBaseline.timestamp <= WINDOW_MS
      this.baseline = recent ? this.eligibleBaseline : null
      this.eligibleBaseline = null
      this.baselineCandidate = null
      this.pending = null
      this.clearWindow()
      this.status = this.baseline ? "stable" : "collecting"
    }
    this.locked = locked
    if (!Number.isFinite(timestamp) || timestamp <= this.lastTimestamp) {
      return this.snapshot()
    }
    this.lastTimestamp = timestamp
    this.observations = this.observations.filter(
      (observation) => timestamp - observation.timestamp <= WINDOW_MS
    )
    if (this.pending && timestamp - this.pending.timestamp > WINDOW_MS) {
      this.pending = null
    }
    if (
      this.baselineCandidate &&
      timestamp - this.baselineCandidate.timestamp > WINDOW_MS
    ) {
      this.baselineCandidate = null
    }
    if (this.latestFit && timestamp - this.latestFit.timestamp > WINDOW_MS) {
      this.status = "limited"
    }
    const ellipse = detection.ellipse
    if (!ellipse || detection.tracking !== "tracking") {
      this.clearWindow()
      this.pending = null
      this.baselineCandidate = null
      this.status = this.baseline ? "limited" : "collecting"
      return this.snapshot()
    }
    if (
      detection.shapeObserved === false ||
      ellipse.confidence < 0.9 ||
      ellipse.major < 6 ||
      ellipse.minor < 4 ||
      !minorAxisLine(ellipse) ||
      timestamp - this.lastSampleTimestamp < MIN_SAMPLE_INTERVAL_MS
    ) {
      return this.snapshot()
    }
    const measured: Ellipse = {
      ...ellipse,
      center: [ellipse.center[0] + roi.x, ellipse.center[1] + roi.y],
    }
    const previous = this.observations.at(-1)?.ellipse
    if (
      previous &&
      pointDistance(measured.center, previous.center) < 1 &&
      Math.abs(Math.sin(measured.angle - previous.angle)) < 0.025
    ) {
      return this.snapshot()
    }
    this.lastSampleTimestamp = timestamp
    this.observations.push({ ellipse: measured, timestamp })
    if (this.observations.length > MAX_SAMPLES) {
      this.observations.shift()
    }
    if (this.observations.length < MIN_SAMPLES) {
      return this.snapshot()
    }
    this.fitCountdown -= 1
    if (this.fitCountdown > 0) {
      return this.snapshot()
    }
    this.fitCountdown = 4
    const ellipses = this.observations.map((observation) => observation.ellipse)
    const minimumMovement = Math.max(2, Math.min(roi.width, roi.height) * 0.025)
    if (
      !hasTwoDimensionalMovement(ellipses, minimumMovement) ||
      !hasIndependentAxes(ellipses)
    ) {
      this.status = "limited"
      return this.snapshot()
    }
    const fit = fitEyeCenter(ellipses, width, height)
    const maximumResidual = Math.max(
      0.75,
      Math.min(roi.width, roi.height) * 0.005
    )
    if (
      !fit ||
      fit.inliers.length < ellipses.length * 0.9 ||
      fit.residual > maximumResidual ||
      !hasTwoDimensionalMovement(fit.inliers, minimumMovement) ||
      !hasIndependentAxes(fit.inliers)
    ) {
      this.status = "limited"
      return this.snapshot()
    }
    this.acceptFit(
      { center: fit.center, residual: fit.residual, timestamp },
      context
    )
    return this.snapshot()
  }
}
