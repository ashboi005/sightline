import type { Point } from "../eye-tracking/eye-tracking.types"
import type { AdaptiveGazeSample } from "./adaptive-gaze-filter.types"

// Experimental display settings, evaluated on synthetic traces only. Coordinates
// use CSS pixels / viewport shorter edge, so beta is independent of pixel density.
// One Euro: https://gery.casiez.net/1euro/ (source dt in seconds, cutoff in Hz).
const MIN_CUTOFF_HZ = 0.65
const SPEED_COEFFICIENT = 6
const DERIVATIVE_CUTOFF_HZ = 1

function alpha(cutoff: number, elapsed: number) {
  return 1 / (1 + 1 / (2 * Math.PI * cutoff * elapsed))
}

/**
 * Smooths display precision; cannot correct systematic gaze/calibration error.
 * Feit et al. (2017):
 * https://www.microsoft.com/en-us/research/wp-content/uploads/2017/01/everyday_eyetracking.pdf
 */
export class AdaptiveGazeFilter {
  private previous: AdaptiveGazeSample | null = null
  private center: Point | null = null
  private derivative: Point = [0, 0]

  reset() {
    this.previous = null
    this.center = null
    this.derivative = [0, 0]
  }

  advance(sample: AdaptiveGazeSample, shorterEdge: number): Point {
    const point: Point = [
      sample.point[0] / shorterEdge,
      sample.point[1] / shorterEdge,
    ]
    if (!this.previous || !this.center) {
      this.previous = { point, timestamp: sample.timestamp }
      this.center = point
      return [...sample.point]
    }
    const elapsed = (sample.timestamp - this.previous.timestamp) / 1000
    // The processor only advances fresh timestamps. Keep this guard so a replay
    // can never integrate a fabricated derivative or refresh filter time.
    if (elapsed <= 0) {
      return [this.center[0] * shorterEdge, this.center[1] * shorterEdge]
    }
    const derivativeAlpha = alpha(DERIVATIVE_CUTOFF_HZ, elapsed)
    this.derivative = [
      this.derivative[0] +
        derivativeAlpha *
          ((point[0] - this.previous.point[0]) / elapsed - this.derivative[0]),
      this.derivative[1] +
        derivativeAlpha *
          ((point[1] - this.previous.point[1]) / elapsed - this.derivative[1]),
    ]
    const speed = Math.hypot(...this.derivative)
    const positionAlpha = alpha(
      MIN_CUTOFF_HZ + SPEED_COEFFICIENT * speed,
      elapsed
    )
    this.center = [
      this.center[0] + positionAlpha * (point[0] - this.center[0]),
      this.center[1] + positionAlpha * (point[1] - this.center[1]),
    ]
    this.previous = { point, timestamp: sample.timestamp }
    return [this.center[0] * shorterEdge, this.center[1] * shorterEdge]
  }
}
