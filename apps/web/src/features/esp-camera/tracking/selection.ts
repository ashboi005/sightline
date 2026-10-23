import type { SceneCameraSnapshot } from "../../scene-tracking/features/scene-eye-tracking/scene-camera.types"
import type { SceneSessionSnapshot } from "../../scene-tracking/features/scene-eye-tracking/scene-session.types"
import type { PreviewPoint } from "./selection.types"
import { AdaptiveGazeFilter } from "../../scene-tracking/features/gaze-bubble/adaptive-gaze-filter"

/** Display continuity never renews measurement time or authorizes a held selection. */
export class SceneGazeCursor {
  private filter = new AdaptiveGazeFilter()
  private key = ""
  private calibration: SceneSessionSnapshot["calibration"] = null
  private point: PreviewPoint | null = null
  private timestamp = -Infinity

  read(
    state: SceneSessionSnapshot,
    scene: SceneCameraSnapshot,
    eyeLocked: boolean,
    now: number
  ) {
    const key = JSON.stringify([
      scene.source?.key,
      scene.frame?.generation,
      scene.transform,
      state.offset,
      scene.frame?.width,
      scene.frame?.height,
    ])
    if (
      key !== this.key ||
      state.calibration !== this.calibration ||
      !eyeLocked ||
      state.capture
    ) {
      this.filter.reset()
      this.point = null
      this.timestamp = -Infinity
      this.key = key
      this.calibration = state.calibration
    }
    const cursor = sceneGazeCursor(state, scene, eyeLocked, now)
    if (cursor.point && scene.frame) {
      const time = state.measurement!.eyeTimestamp!
      if (time !== this.timestamp) {
        const { width, height } = scene.frame
        const point = this.filter.advance(
          {
            point: [cursor.point[0] * width, cursor.point[1] * height],
            timestamp: time,
          },
          Math.min(width, height)
        )
        this.point = [point[0] / width, point[1] / height]
        this.timestamp = time
      }
      return {
        ...cursor,
        point: this.point,
        displayPoint: this.point,
        held: false,
      }
    }
    const outside = state.measurement?.position?.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1
    )
    const held =
      !outside &&
      !!this.point &&
      now >= this.timestamp &&
      now - this.timestamp <= 350
    if (!held) {
      this.filter.reset()
      this.point = null
      this.timestamp = -Infinity
    }
    return { ...cursor, displayPoint: held ? this.point : null, held }
  }
}

/** The calibrated position is already in the oriented Scene image's coordinates. */
export function sceneGazeCursor(
  state: SceneSessionSnapshot,
  scene: SceneCameraSnapshot,
  eyeLocked: boolean,
  now: number
): { point: PreviewPoint | null; message: string } {
  const unavailable = (message: string) => ({ point: null, message })
  if (!state.calibration || !eyeLocked)
    return unavailable(
      "Complete Eye Tracker Setup and load your calibration to use the gaze cursor."
    )
  if (state.capture)
    return unavailable(
      "Finish the calibration capture before selecting with gaze."
    )
  const fresh = (timestamp: number | null | undefined, maxAge = 500) =>
    timestamp != null &&
    Number.isFinite(timestamp) &&
    Number.isFinite(now) &&
    now >= timestamp &&
    now - timestamp <= maxAge
  if (!hasFreshFrame(scene, now) || !fresh(scene.frame?.timestamp))
    return unavailable(
      "Wait for a fresh scene camera frame to select with gaze."
    )
  const measurement = state.measurement
  if (
    !measurement ||
    !fresh(measurement.timestamp) ||
    !fresh(measurement.eyeTimestamp, 500 + Math.abs(state.delayMs)) ||
    !fresh(measurement.sceneTimestamp)
  )
    return unavailable(
      "Gaze cursor paused. Look at the person and wait for fresh eye tracking."
    )
  const point = measurement.position
  if (
    (!measurement.valid && !measurement.preview) ||
    !point ||
    !point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  )
    return unavailable(
      measurement.reason || "Look inside the scene view to select with gaze."
    )
  return {
    point,
    message:
      measurement.preview || measurement.estimated
        ? "Gaze cursor · accuracy not verified. Look at a person and say “select”."
        : "Gaze cursor ready. Look at a person and say “select”.",
  }
}

export function hasFreshFrame(
  state: SceneCameraSnapshot,
  now: number
): boolean {
  const frame = state.frame
  return (
    !!state.source &&
    state.connection === "live" &&
    !state.busy &&
    !!frame &&
    frame.width > 0 &&
    frame.height > 0 &&
    Number.isFinite(frame.timestamp) &&
    Number.isFinite(now) &&
    now >= frame.timestamp &&
    now - frame.timestamp <= 1000
  )
}
