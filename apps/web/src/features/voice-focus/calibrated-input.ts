import type { SceneGazeSample } from "@sightline/contracts";
import { SceneGazeCursor } from "../esp-camera/tracking/selection";
import type { SceneCameraSnapshot } from "../scene-tracking/features/scene-eye-tracking/scene-camera.types";
import type { SceneSessionSnapshot } from "../scene-tracking/features/scene-eye-tracking/scene-session.types";

/** One coordinate system: calibrated gaze and the oriented POV frames sent to the speaker service. */
export class VoiceFocusGaze {
  private readonly cursor = new SceneGazeCursor();
  read(
    session: SceneSessionSnapshot,
    scene: SceneCameraSnapshot,
    eyeLocked: boolean,
    now: number,
  ) {
    const cursor = this.cursor.read(session, scene, eyeLocked, now);
    const measurement = session.measurement;
    const gaze: SceneGazeSample | null =
      cursor.point && measurement?.valid && measurement.eyeTimestamp != null
        ? {
            x: cursor.point[0],
            y: cursor.point[1],
            valid: true,
            confidence: measurement.confidence,
            ts: measurement.eyeTimestamp,
          }
        : null;
    return {
      ...cursor,
      gaze,
      message:
        cursor.point && !measurement?.valid
          ? "Validate your calibration before selecting a speaker with gaze."
          : cursor.message,
    };
  }
}
