import type { Point } from "../eye-tracking/eye-tracking.types"
import { getGazeView } from "../gaze-bubble/gaze-bubble"
import type { GazeImageSize } from "../gaze-bubble/gaze-bubble.types"
import type {
  CorrectionBounds,
  CorrectionResult,
  CorrectionSample,
} from "./gaze-correction.types"

const WINDOW_MS = 300
const MAX_AGE_MS = 150
const MIN_SPAN_MS = 100
const MAX_SPREAD = 0.045

/** Convert a click to the same normalized image/viewport space as calibration. */
export function correctionTarget(
  click: Point,
  bounds: CorrectionBounds,
  image?: GazeImageSize
): Point | null {
  if (
    ![...click, bounds.left, bounds.top, bounds.width, bounds.height].every(
      Number.isFinite
    )
  ) {
    return null
  }
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null
  }
  if (image && (image.width <= 0 || image.height <= 0)) {
    return null
  }
  const view = getGazeView(bounds.width, bounds.height, image)
  if (!view) {
    return null
  }
  const x = (click[0] - bounds.left - view.left) / view.width
  const y = (click[1] - bounds.top - view.top) / view.height
  if (
    ![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  ) {
    return null
  }
  return [x, y]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2
  }
  return sorted[middle]!
}

/** Short, raw gaze history. Never use the display bubble as a measurement. */
export class GazeCorrectionSampler {
  private samples: CorrectionSample[] = []

  clear(): void {
    this.samples = []
  }

  add(point: Point | null, timestamp: number | null): void {
    if (
      !point ||
      timestamp === null ||
      ![...point, timestamp].every(Number.isFinite)
    ) {
      this.clear()
      return
    }
    const last = this.samples.at(-1)
    if (last && timestamp === last.timestamp) {
      return
    }
    if (
      last &&
      (timestamp < last.timestamp || timestamp - last.timestamp > MAX_AGE_MS)
    ) {
      this.clear()
    }
    this.samples = this.samples.filter(
      (sample) => timestamp - sample.timestamp <= WINDOW_MS
    )
    this.samples.push({ point: [...point], timestamp })
  }

  correct(
    target: Point,
    offset: Point,
    now: number,
    maxAgeMs = MAX_AGE_MS
  ): CorrectionResult {
    if (
      ![...target, ...offset, now, maxAgeMs].every(Number.isFinite) ||
      maxAgeMs < 0 ||
      maxAgeMs > 1000 ||
      target.some((value) => value < 0 || value > 1)
    ) {
      return { offset: null, error: "Click inside the tracking view." }
    }
    const latestTime = this.samples.at(-1)?.timestamp ?? now
    const recent = this.samples.filter(
      (sample) => latestTime - sample.timestamp <= WINDOW_MS
    )
    const first = recent[0]
    const last = recent.at(-1)
    if (
      !first ||
      !last ||
      recent.length < 3 ||
      now < last.timestamp ||
      now - last.timestamp > maxAgeMs ||
      last.timestamp - first.timestamp < MIN_SPAN_MS
    ) {
      return { offset: null, error: "Wait for live gaze, then click again." }
    }
    const center: Point = [
      median(recent.map((sample) => sample.point[0])),
      median(recent.map((sample) => sample.point[1])),
    ]
    const distances = recent
      .map((sample) =>
        Math.hypot(sample.point[0] - center[0], sample.point[1] - center[1])
      )
      .sort((a, b) => a - b)
    const spread = distances[Math.ceil(distances.length * 0.9) - 1]!
    if (spread > MAX_SPREAD) {
      return {
        offset: null,
        error: "Keep looking at the target, then click again.",
      }
    }
    const next: Point = [
      offset[0] + target[0] - center[0],
      offset[1] + target[1] - center[1],
    ]
    if (next.some((value) => Math.abs(value) > 1)) {
      return {
        offset: null,
        error:
          "This shift is too large. Check the camera orientation and calibration.",
      }
    }
    return { offset: next, error: null }
  }
}
