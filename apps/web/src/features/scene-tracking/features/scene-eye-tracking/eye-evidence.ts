import { gazeFeature } from "../eye-tracking/calibration"
import type { TrackingFrame } from "../eye-tracking/eye-tracking.types"
import { eyeEvidenceIssue, MAX_FRAME_AGE_MS } from "./calibration"
import type { EyeObservation } from "./scene.types"
// Shared observation construction keeps the monitor and collector on the same inputs.
export function sceneEyeEvidence(
  frame: TrackingFrame | null,
  locked: boolean,
  now: number
) {
  let observation: EyeObservation | null = null
  if (frame) {
    observation = {
      id: frame.id,
      timestamp: frame.timestamp,
      feature: frame.gaze ? gazeFeature(frame.gaze.direction) : null,
      confidence: frame.detection.ellipse?.confidence ?? 0,
      recoverable: locked && frame.detection.tracking === "reacquiring",
      valid:
        locked &&
        !!frame.gaze &&
        !!frame.detection.ellipse &&
        frame.detection.tracking !== "reacquiring" &&
        frame.detection.tracking !== "lost",
    }
  }
  const issue = eyeEvidenceIssue(observation)
  const fresh =
    !!frame &&
    Number.isFinite(now) &&
    now >= frame.timestamp &&
    now - frame.timestamp <= MAX_FRAME_AGE_MS
  const ready = fresh && !issue
  let hint = "Eye ready"
  if (!frame) {
    hint = "Waiting for eye frames"
  } else if (!locked) {
    hint = "Eye model unlocked"
  } else if (frame.detection.tracking === "reacquiring") {
    hint = "Reacquiring pupil"
  } else if (!frame.detection.ellipse || frame.detection.tracking === "lost") {
    hint = "Pupil unavailable"
  } else if (!frame.gaze) {
    hint = "No gaze vector"
  } else if (!observation?.feature) {
    hint = "Gaze outside model range"
  } else if (!fresh) {
    hint = "Eye frames delayed"
  } else {
    hint = issue?.hint ?? hint
  }
  if (observation && !ready) {
    observation.reason = hint
  }
  return {
    observation,
    confidence: frame?.detection.ellipse?.confidence ?? null,
    ready,
    hint,
  }
}
