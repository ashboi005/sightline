import type { Point } from "../eye-tracking/eye-tracking.types"
import { AdaptiveGazeFilter } from "./adaptive-gaze-filter"
import type {
  GazeBubbleOptions,
  GazeBubbleProfile,
  GazeBubbleSample,
  GazeBubbleState,
  GazeEdgeIndicator,
  GazeImageSize,
  GazeView,
  PixelSample,
} from "./gaze-bubble.types"

export const GAZE_BUBBLE_MAX_AGE_MS = 350
const REMOTE_MAX_AGE_MS = 1000
// Reference: Newn et al. (CHI PLAY 2017), Tobii Gaze Trace's 150px radius.
// Adopted in CSS pixels; not a verified Eye Tracker 5/Ghost default.
const MAX_DIAMETER_PX = 300
const WINDOW_MS = 160
const STABLE_MS = 120
const MAX_GAP_MS = 150

/** Age is always measured from the original source timestamp, including replay. */
export function getGazeBubbleMaxAge(
  profile?: GazeBubbleProfile,
  maxAgeMs?: number
) {
  const defaultAge = profile ? REMOTE_MAX_AGE_MS : GAZE_BUBBLE_MAX_AGE_MS
  const age = maxAgeMs ?? defaultAge
  if (profile && Number.isFinite(age)) {
    return Math.min(age, REMOTE_MAX_AGE_MS)
  }
  return age
}

/** Hard outer size in CSS pixels, shared by the estimator and animated renderer. */
export function getGazeBubbleMaxDiameter(width: number, height: number) {
  return Math.min(MAX_DIAMETER_PX, Math.min(width, height) * 0.5)
}

function distance(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
function outsideView(point: Point) {
  return point.some((value) => value < 0 || value > 1)
}

/** Edge location is display geometry only, never a substituted gaze coordinate. */
export function getGazeEdgeIndicator(
  bubble: GazeBubbleState,
  width: number,
  height: number
): GazeEdgeIndicator | null {
  if (!bubble.outside) {
    return null
  }
  const point = outsideView(bubble.rawPoint) ? bubble.rawPoint : bubble.center
  const direction = point.map((value) => {
    if (value < 0) {
      return -1
    }
    if (value > 1) {
      return 1
    }
    return 0
  })
  const inset = Math.min(8, width / 2, height / 2)
  return {
    left: Math.max(inset, Math.min(width - inset, point[0] * width)),
    top: Math.max(inset, Math.min(height - inset, point[1] * height)),
    angle: (Math.atan2(direction[1], direction[0]) * 180) / Math.PI,
  }
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}
function centerOf(samples: PixelSample[]): Point {
  return [
    median(samples.map((s) => s.point[0])),
    median(samples.map((s) => s.point[1])),
  ]
}

/** CSS geometry of an object-fit:contain image, or the entire screen. */
export function getGazeView(
  width: number,
  height: number,
  image?: GazeImageSize
): GazeView | null {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) {
    return null
  }
  if (!image) {
    return { width, height, left: 0, top: 0, scale: 1 }
  }
  if (![image.width, image.height].every((n) => Number.isFinite(n) && n > 0)) {
    return null
  }
  const scale = Math.min(width / image.width, height / image.height)
  const viewWidth = image.width * scale
  const viewHeight = image.height * scale
  return {
    width: viewWidth,
    height: viewHeight,
    left: (width - viewWidth) / 2,
    top: (height - viewHeight) / 2,
    scale,
  }
}

/** Display-only estimator. It never updates calibration or the input samples. */
export class GazeBubbleProcessor {
  private history: PixelSample[] = []
  private center: Point | null = null
  private previous: PixelSample | null = null
  private pending: PixelSample | null = null
  private stable = false
  private width = 0
  private height = 0
  private stabilize = true
  private profile: GazeBubbleProfile | undefined
  private adaptive = new AdaptiveGazeFilter()

  reset() {
    this.history = []
    this.center = null
    this.previous = null
    this.pending = null
    this.stable = false
    this.adaptive.reset()
  }

  update(
    sample: GazeBubbleSample | null,
    options: GazeBubbleOptions,
    now: number
  ): GazeBubbleState | null {
    const maxAge = getGazeBubbleMaxAge(options.profile, options.maxAgeMs)
    if (
      !Number.isFinite(maxAge) ||
      maxAge < 0 ||
      ![options.width, options.height].every(
        (n) => Number.isFinite(n) && n > 0
      ) ||
      !Number.isFinite(now)
    ) {
      this.reset()
      return null
    }
    if (
      this.width !== options.width ||
      this.height !== options.height ||
      this.stabilize !== options.stabilize ||
      this.profile !== options.profile
    ) {
      this.reset()
      this.width = options.width
      this.height = options.height
      this.stabilize = options.stabilize
      this.profile = options.profile
    }
    if (!sample) {
      // Hide missing readings immediately, but preserve remote smoothing across
      // a brief blink. Only the last real observation can extend its lifetime.
      const recentRemoteReading =
        options.profile &&
        this.previous &&
        now >= this.previous.timestamp &&
        now - this.previous.timestamp <= maxAge
      if (!recentRemoteReading) {
        this.reset()
      }
      return null
    }
    if (
      !sample.point.every(Number.isFinite) ||
      !Number.isFinite(sample.timestamp) ||
      now < sample.timestamp ||
      now - sample.timestamp > maxAge
    ) {
      this.reset()
      return null
    }
    if (
      this.previous &&
      (sample.timestamp < this.previous.timestamp ||
        now - this.previous.timestamp > maxAge ||
        sample.timestamp - this.previous.timestamp >
          (options.profile ? REMOTE_MAX_AGE_MS : MAX_GAP_MS))
    ) {
      this.reset()
    }
    const current: PixelSample = {
      point: [
        sample.point[0] * options.width,
        sample.point[1] * options.height,
      ],
      timestamp: sample.timestamp,
    }
    if (!this.previous || current.timestamp > this.previous.timestamp) {
      this.advance(current, options)
      this.previous = current
    }
    if (!this.center) {
      return null
    }
    const cap = getGazeBubbleMaxDiameter(options.width, options.height) / 2
    const error = options.errorRadiusPx
    const measured = error !== null && Number.isFinite(error) && error >= 0
    const failed = error === Infinity
    const requested = measured ? Math.max(10, error) : 14
    const center: Point = [
      this.center[0] / options.width,
      this.center[1] / options.height,
    ]
    const outside = outsideView(sample.point) || outsideView(center)
    return {
      center,
      rawPoint: [...sample.point],
      radiusPx: failed ? cap : Math.min(cap, requested),
      errorRadiusPx: measured || failed ? error : null,
      limited: failed || (measured && error > cap),
      verified: options.verified && measured && !outside,
      outside,
      motion: this.stable ? "stable" : "moving",
    }
  }

  private advance(current: PixelSample, options: GazeBubbleOptions) {
    if (options.profile === "remote-adaptive") {
      this.center = this.adaptive.advance(
        current,
        Math.min(options.width, options.height)
      )
      return
    }
    // Movement thresholds deliberately do not depend on error or bubble radius.
    const lockRadius = Math.min(
      6,
      Math.min(options.width, options.height) * 0.015
    )
    const releaseRadius = lockRadius * 1.75
    if (!this.center || !this.previous) {
      this.center = [...current.point]
      this.history = [current]
      return
    }
    if (this.stable) {
      if (distance(current.point, this.center) <= releaseRadius) {
        this.pending = null
        return
      }
      const coherent =
        this.pending &&
        distance(current.point, this.pending.point) <=
          Math.max(12, distance(current.point, this.center) * 0.25)
      if (!this.pending) {
        this.pending = current
        return
      }
      if (!coherent && current.timestamp - this.pending.timestamp < 80) {
        return
      }
      // Two fresh measurements confirm a shift. Reset the filter here; the
      // renderer provides the short visual transition to the new position.
      this.center = [...current.point]
      this.history = [current]
      this.pending = null
      this.stable = false
      return
    }
    const elapsed = (current.timestamp - this.previous.timestamp) / 1000
    const speed = distance(current.point, this.previous.point) / elapsed
    const minimumCutoff = options.stabilize ? 4 : 8
    const cutoff = minimumCutoff + Math.min(20, speed / 50)
    const alpha = 1 - Math.exp(-2 * Math.PI * cutoff * elapsed)
    this.center = [
      this.center[0] + alpha * (current.point[0] - this.center[0]),
      this.center[1] + alpha * (current.point[1] - this.center[1]),
    ]
    // Keep at least four distinct samples across slow or uneven delivery. Long
    // gaps reset above, so these cannot span separate tracking periods.
    const recent = [...this.history, current]
    this.history = recent
      .filter(
        (s, index) =>
          index >= recent.length - 4 ||
          current.timestamp - s.timestamp <= WINDOW_MS
      )
      .slice(-32)
    if (
      !options.stabilize ||
      this.history.length < 4 ||
      current.timestamp - this.history[0].timestamp < STABLE_MS
    ) {
      return
    }
    const anchor = centerOf(this.history)
    if (this.history.every((s) => distance(s.point, anchor) <= lockRadius)) {
      this.center = anchor
      this.stable = true
    }
  }
}
