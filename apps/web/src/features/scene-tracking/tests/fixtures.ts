import { SceneSession } from "../features/scene-eye-tracking/scene-session"
import {
  CALIBRATION_TARGETS,
  VALIDATION_TARGETS,
} from "../features/scene-eye-tracking/calibration"

export function calibrate(withValidation = true) {
  const s = new SceneSession()
  s.startCapture("calibration")
  let id = 0,
    time = 0
  for (const [x, y] of [
    ...CALIBRATION_TARGETS,
    ...(withValidation ? VALIDATION_TARGETS : []),
  ]) {
    for (let frame = 0; frame < 35; frame++) {
      id++
      time += 50
      s.addEye({
        id,
        timestamp: time,
        feature: [x - 0.5, y - 0.5],
        confidence: 0.9,
        valid: true,
      })
      s.observeHand(
        {
          scene: {
            id,
            timestamp: time,
            width: 640,
            height: 480,
            generation: 1,
          },
          landmarks: [Array.from({ length: 21 }, () => ({ x, y, z: 0 }))],
          worldLandmarks: [],
          handedness: ["Right"],
        },
        time
      )
      if (s.getSnapshot().collection?.canLock) s.lockPoint()
    }
  }
  return { s, id, time }
}

export function collectValidation(
  s: SceneSession,
  id: number,
  featureShift: (index: number) => [number, number] = () => [0, 0],
  targets = VALIDATION_TARGETS
) {
  for (const [index, [x, y]] of targets.entries())
    for (let frame = 0; frame < 35; frame++) {
      id++
      const shift = featureShift(index)
      s.addEye({
        id,
        timestamp: id * 50,
        feature: [x - 0.5 + shift[0], y - 0.5 + shift[1]],
        confidence: 0.95,
        valid: true,
      })
      s.observeHand(
        {
          scene: {
            id,
            timestamp: id * 50,
            width: 640,
            height: 480,
            generation: 1,
          },
          landmarks: [Array.from({ length: 21 }, () => ({ x, y, z: 0 }))],
          worldLandmarks: [],
          handedness: ["Right"],
        },
        id * 50
      )
      if (s.getSnapshot().collection?.canLock) s.lockPoint()
    }
  return { id, time: id * 50 }
}
