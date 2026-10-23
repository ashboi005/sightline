import { detectSpatialPupil, isContinuousPupil } from "./detection"
import type { PupilDetectionOptions } from "./detection.types"
import type { PendingPupilFit } from "./engine.types"
import type { Detection, Ellipse, Point } from "./eye-tracking.types"
import type { CV } from "./opencv.types"
const pupilMemoryMs = 750
/** Shared acquisition, measured-rim tracking, shape refresh and reacquisition for one eye. */
export class PupilTracker {
  private previousSelected: number | undefined
  private previous: Ellipse | null = null
  private trackingAnchor: Ellipse | null = null
  private seenAt = -Infinity
  private shapeSeenAt = -Infinity
  private shapeCheckedAt = -Infinity
  private anchorObservations = 0
  private pupilIntensity: number | undefined
  private pupilIntensityLow: number | undefined
  private pupilReflectionLimit: number | undefined
  private pending: PendingPupilFit | null = null
  private readonly cv: CV
  constructor(cv: CV) {
    this.cv = cv
  }
  /** Accepted full-rim appearance, retained while position is measured from partial arcs. */
  get intensity(): number | undefined {
    return this.pupilIntensity
  }
  /** A search hint only; callers must still measure the current pupil pixels. */
  recentCenter(timestamp: number, maximumAgeMs: number): Point | null {
    const age = timestamp - this.seenAt
    return this.previous &&
      Number.isFinite(age) &&
      Number.isFinite(maximumAgeMs) &&
      age >= 0 &&
      age <= Math.min(pupilMemoryMs, maximumAgeMs)
      ? [...this.previous.center]
      : null
  }
  reset() {
    this.previousSelected = undefined
    this.previous = null
    this.trackingAnchor = null
    this.pending = null
    this.seenAt = -Infinity
    this.shapeSeenAt = -Infinity
    this.shapeCheckedAt = -Infinity
    this.anchorObservations = 0
    this.pupilIntensity = undefined
    this.pupilIntensityLow = undefined
    this.pupilReflectionLimit = undefined
  }
  detect(
    gray: Uint8Array,
    width: number,
    height: number,
    threshold: number,
    timestamp: number,
    options: PupilDetectionOptions = {}
  ): Detection {
    if (timestamp - this.seenAt > pupilMemoryMs) {
      this.previous = null
      this.pending = null
    }
    if (timestamp - this.seenAt > 3000) {
      this.trackingAnchor = null
      this.anchorObservations = 0
      this.pupilIntensity = undefined
      this.pupilIntensityLow = undefined
      this.pupilReflectionLimit = undefined
    }
    return detectSpatialPupil(this.cv, gray, width, height, threshold, {
      ...options,
      previous: this.previous,
      previousAgeMs: timestamp - this.seenAt,
      previousShapeAgeMs: timestamp - this.shapeSeenAt,
      pupilIntensity: this.pupilIntensity,
      pupilIntensityLow: this.pupilIntensityLow,
      pupilReflectionLimit: this.pupilReflectionLimit,
      refreshShape: timestamp - this.shapeCheckedAt >= 200,
      trackingAnchor: this.trackingAnchor,
      trackingAnchorConfirmed: this.anchorObservations >= 2,
      previousSelected: this.previousSelected,
    })
  }
  /** Commit only the selected, anatomically validated pupil candidate. */
  accept(
    detection: Detection,
    timestamp: number,
    width: number,
    height: number
  ): Detection {
    if (detection.fullShapeSearched) {
      this.shapeCheckedAt = timestamp
    }
    this.associate(detection, timestamp, width, height)
    return detection
  }
  /** Remap history when an independently observed eye frame moves, rotates or changes scale. */
  transform(scale: number, angle: number, offset: Point) {
    if (!(scale > 0) || ![scale, angle, ...offset].every(Number.isFinite)) {
      this.reset()
      return
    }
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const map = (e: Ellipse): Ellipse => ({
      ...e,
      center: [
        scale * (c * e.center[0] - s * e.center[1]) + offset[0],
        scale * (s * e.center[0] + c * e.center[1]) + offset[1],
      ],
      major: e.major * scale,
      minor: e.minor * scale,
      angle: e.angle + angle,
    })
    if (this.previous) {
      this.previous = map(this.previous)
    }
    if (this.trackingAnchor) {
      this.trackingAnchor = map(this.trackingAnchor)
    }
    if (this.pending) {
      this.pending = { ...this.pending, ellipse: map(this.pending.ellipse) }
    }
  }
  /** Never replace a missing measurement with an old gaze. Confirm abrupt relocations. */
  private associate(
    detection: Detection,
    timestamp: number,
    width: number,
    height: number
  ) {
    const candidate = detection.ellipse
    if (!candidate) {
      this.pending = null
      detection.tracking = this.previous ? "reacquiring" : "lost"
      if (this.previous && detection.reason === "Pupil not found") {
        detection.reason = "Reacquiring pupil"
      }
      return
    }
    const continuous =
      this.previous &&
      isContinuousPupil(candidate, this.previous, width, height)
    const confirmed =
      this.pending &&
      timestamp - this.pending.time <= 150 &&
      isContinuousPupil(candidate, this.pending.ellipse, width, height)
    const anchor = this.trackingAnchor
    const sameScale =
      anchor &&
      candidate.major / anchor.major >= 0.55 &&
      candidate.major / anchor.major <= 1.6
    const observedMovement =
      detection.strongEvidence === true &&
      this.anchorObservations >= 2 &&
      sameScale
    const accepted = continuous
      ? candidate.confidence >= 0.72
      : candidate.confidence >= 0.82 &&
        (!this.previous || confirmed || observedMovement)
    if (!accepted) {
      this.pending = { ellipse: candidate, time: timestamp }
      detection.candidate = candidate
      detection.ellipse = null
      detection.tracking = "reacquiring"
      detection.reason =
        candidate.confidence < 0.82
          ? "Weak outline · adjust cutoff or reduce glare"
          : "Confirming pupil movement"
      return
    }
    const establishedAnchor = this.anchorObservations >= 2
    this.previous = candidate
    if (detection.shapeObserved !== false) {
      this.shapeSeenAt = timestamp
      this.shapeCheckedAt = timestamp
      if (
        candidate.confidence >= 0.8 &&
        detection.pupilIntensity !== undefined
      ) {
        this.pupilIntensity = detection.pupilIntensity
        this.pupilIntensityLow = detection.pupilIntensityLow
        this.pupilReflectionLimit = detection.pupilReflectionLimit
      }
    }
    if (
      detection.strongEvidence &&
      (!establishedAnchor ||
        (anchor &&
          candidate.major / anchor.major >= 0.7 &&
          candidate.major / anchor.major <= 1.4))
    ) {
      this.anchorObservations =
        anchor &&
        candidate.major / anchor.major >= 0.7 &&
        candidate.major / anchor.major <= 1.4
          ? Math.min(3, this.anchorObservations + 1)
          : 1
    }
    if (detection.previews[detection.selected]?.method !== "tracking") {
      // A weak cap under the lid must not progressively shrink the remembered
      // pupil. Update its scale only from independently supported full rims.
      if (
        !this.trackingAnchor ||
        (detection.strongEvidence &&
          (!establishedAnchor ||
            (candidate.major / this.trackingAnchor.major >= 0.9 &&
              candidate.major / this.trackingAnchor.major <= 1.25)))
      ) {
        this.trackingAnchor = candidate
      }
      this.previousSelected =
        detection.selected >= 0 ? detection.selected : undefined
    } else if (
      anchor &&
      detection.strongEvidence &&
      detection.shapeObserved !== false &&
      candidate.major / anchor.major >= 0.7 &&
      candidate.major / anchor.major <= 1.4
    ) {
      // Strong full rims can observe gradual physiological size changes.
      // Adapt size slowly, preserving the independently measured aspect ratio,
      // center and angle so weak caps cannot redefine the reference shape.
      const scale = 1 + 0.1 * (candidate.major / anchor.major - 1)
      this.trackingAnchor = {
        ...anchor,
        major: anchor.major * scale,
        minor: anchor.minor * scale,
      }
    }
    this.seenAt = timestamp
    this.pending = null
    detection.tracking = "tracking"
    detection.reason = "Pupil found"
  }
}
