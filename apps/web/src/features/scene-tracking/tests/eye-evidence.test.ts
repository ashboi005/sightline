import { expect, test } from "bun:test"
import type { TrackingFrame } from "../features/eye-tracking/eye-tracking.types"
import { sceneEyeEvidence } from "../features/scene-eye-tracking/eye-evidence"
import { eyeEvidenceIssue } from "../features/scene-eye-tracking/calibration"

function frame(): TrackingFrame {
  return {
    id: 1,
    timestamp: 1000,
    width: 640,
    height: 480,
    roi: { x: 0, y: 0, width: 640, height: 480 },
    detection: {
      ellipse: {
        center: [320, 240],
        major: 30,
        minor: 20,
        angle: 0,
        confidence: 0.88,
      },
      tracking: "tracking",
      seed: null,
      contour: [],
      refined: [],
      previews: [],
      selected: 0,
      reason: "",
    },
    model: null,
    gaze: { origin: [0, 0, 0], pupil: [0, 0, -1], direction: [0, 0, -1] },
    processingMs: 5,
  }
}

test("a visible high-confidence pupil without a gaze vector is not shown as calibration-ready", () => {
  const eye = frame()
  eye.gaze = null
  const evidence = sceneEyeEvidence(eye, true, 1000)
  expect(evidence.confidence).toBe(0.88)
  expect(evidence.ready).toBe(false)
  expect(evidence.hint).toContain("gaze vector")
  expect(evidence.observation?.valid).toBe(false)
  expect(eyeEvidenceIssue(evidence.observation)?.hint).toContain("gaze vector")
})

test("a tracked pupil with an unusable gaze direction is distinguished from pupil loss", () => {
  const eye = frame()
  eye.gaze!.direction = [1, 0, 0]
  const evidence = sceneEyeEvidence(eye, true, 1000)
  expect(evidence.ready).toBe(false)
  expect(evidence.hint).toContain("range")
  expect(evidence.observation?.feature).toBeNull()
})

test("reacquiring pupil evidence remains unavailable even if an ellipse and gaze exist", () => {
  const eye = frame()
  eye.detection.tracking = "reacquiring"
  const evidence = sceneEyeEvidence(eye, true, 1000)
  expect(evidence.ready).toBe(false)
  expect(evidence.hint).toContain("Reacquiring")
  expect(evidence.observation?.valid).toBe(false)
})

test("a locked pupil reacquisition pauses calibration without treating the rejected frame as gaze", () => {
  const eye = frame()
  eye.detection.tracking = "reacquiring"
  eye.detection.candidate = eye.detection.ellipse!
  eye.detection.ellipse = null
  eye.gaze = null
  const evidence = sceneEyeEvidence(eye, true, 1000)
  expect(evidence.ready).toBe(false)
  expect(evidence.observation?.valid).toBe(false)
  expect(evidence.observation?.feature).toBeNull()
  expect(eyeEvidenceIssue(evidence.observation)?.canPause).toBe(true)
  expect(
    eyeEvidenceIssue(sceneEyeEvidence(eye, false, 1000).observation)?.canPause
  ).toBe(false)
  eye.detection.tracking = "lost"
  expect(
    eyeEvidenceIssue(sceneEyeEvidence(eye, true, 1000).observation)?.canPause
  ).toBe(false)
})

test("weak pupil confidence is displayed but excluded from readiness", () => {
  const eye = frame()
  eye.detection.ellipse!.confidence = 0.68
  const evidence = sceneEyeEvidence(eye, true, 1000)
  expect(evidence.ready).toBe(false)
  expect(evidence.hint).toContain("68%")
})

test("only a fresh locked eye with usable gaze is shown as ready", () => {
  const eye = frame()
  expect(sceneEyeEvidence(eye, true, 1000).ready).toBe(true)
  expect(sceneEyeEvidence(eye, false, 1000).ready).toBe(false)
  expect(sceneEyeEvidence(eye, true, 1400).ready).toBe(false)
  expect(sceneEyeEvidence(null, true, 1000).ready).toBe(false)
})
