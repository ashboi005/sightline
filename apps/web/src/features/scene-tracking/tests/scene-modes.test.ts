import { expect, test } from "bun:test"
import { SceneSession } from "../features/scene-eye-tracking/scene-session"
import { DEFAULT_CAMERA_TRANSFORM } from "../features/eye-tracking/camera-transform"
import { calibrate } from "./fixtures"
import {
  CALIBRATION_TARGETS,
  VALIDATION_TARGETS,
  mapSceneGaze,
} from "../features/scene-eye-tracking/calibration"
import {
  createSessionLog,
  appendMeasurement,
  exportSessionCsv,
  exportSessionJson,
} from "../features/scene-eye-tracking/session"

function hold(
  session: SceneSession,
  target: [number, number],
  feature: [number, number],
  start = 0,
  marker = false
) {
  for (let i = 1; i <= 40; i++) {
    const id = start + i,
      timestamp = id * 50
    session.addEye({ id, timestamp, feature, confidence: 0.95, valid: true })
    const scene = { id, timestamp, width: 640, height: 480, generation: 1 }
    if (marker)
      session.observeReference(
        { scene, position: target, kind: "marker" },
        timestamp
      )
    else
      session.observeHand(
        {
          scene,
          landmarks: [
            Array.from({ length: 21 }, () => ({
              x: target[0],
              y: target[1],
              z: 0,
            })),
          ],
          worldLandmarks: [],
          handedness: ["Right"],
        },
        timestamp
      )
    if (session.getSnapshot().collection?.canLock && !marker)
      session.lockPoint()
  }
  return start + 40
}

test("one-point gain changes preserve the adjusted front-facing eye relationship", () => {
  const s = new SceneSession("one-point")
  const orientation = {
    eye: { ...DEFAULT_CAMERA_TRANSFORM, rotation: 90 },
    scene: DEFAULT_CAMERA_TRANSFORM,
  }
  s.setCameraOrientation(orientation)
  s.startCapture("calibration")
  hold(s, [0.5, 0.5], [0, 0])
  expect(s.getSnapshot().calibration?.coefficients[0][1]).toBe(-0.5)
  expect(s.getSnapshot().calibration?.onePoint?.orientation).toEqual(
    orientation
  )
  s.setOnePointGain([1, 1])
  expect(s.getSnapshot().calibration?.coefficients).toEqual([
    [0.5, -1, 0],
    [0.5, 0, 1],
  ])
  const mapping = s.getSnapshot().calibration
  s.setCameraOrientation(orientation)
  expect(s.getSnapshot().calibration).toBe(mapping)
  s.setCameraOrientation({ ...orientation, eye: DEFAULT_CAMERA_TRANSFORM })
  expect(s.getSnapshot().calibration).toBeNull()
})

test("one-point capture accepts a fingertip anywhere and opens estimated tracking without a fake validation pass", () => {
  const session = new SceneSession("one-point")
  session.startCapture("calibration")
  const id = hold(session, [0.7, 0.3], [0.1, -0.2])
  expect(session.getSnapshot().capture).toBeNull()
  expect(session.getSnapshot().calibration?.holds).toHaveLength(1)
  expect(session.getSnapshot().validation).toBeNull()
  session.addEye({
    id: id + 1,
    timestamp: (id + 1) * 50,
    feature: [0.3, -0.1],
    confidence: 0.95,
    valid: true,
  })
  session.measure(
    {
      id: id + 1,
      timestamp: (id + 1) * 50,
      width: 640,
      height: 480,
      generation: 1,
    },
    (id + 1) * 50
  )
  const measurement = session.getSnapshot().measurement!
  expect(measurement.position![0]).toBeCloseTo(0.6, 6)
  expect(measurement.position![1]).toBeCloseTo(0.3 + (0.1 * 2) / 3, 6)
  expect(measurement.valid).toBe(true)
  expect(measurement.estimated).toBe(true)
})

test("one-point mode reanchors a verified mapping instead of inventing its shape", () => {
  const { s, id: initial } = calibrate()
  s.setMethod("one-point")
  s.startCapture("calibration")
  const id = hold(s, [0.6, 0.4], [0, 0], initial)
  expect(s.getSnapshot().calibration?.onePoint?.basis).toBe("previous")
  s.addEye({
    id: id + 1,
    timestamp: (id + 1) * 50,
    feature: [0.1, 0.2],
    confidence: 0.95,
    valid: true,
  })
  s.measure(
    {
      id: id + 1,
      timestamp: (id + 1) * 50,
      width: 640,
      height: 480,
      generation: 1,
    },
    (id + 1) * 50
  )
  expect(s.getSnapshot().measurement!.position![0]).toBeCloseTo(0.7, 6)
  expect(s.getSnapshot().measurement!.position![1]).toBeCloseTo(0.6, 6)
  expect(s.getSnapshot().measurement!.estimated).toBe(true)
})

test("marker capture saves only new covered regions automatically", () => {
  const s = new SceneSession("marker")
  s.startCapture("calibration")
  let id = hold(s, [0.5, 0.5], [0, 0], 0, true)
  expect(s.getSnapshot().collection?.holds).toHaveLength(1)
  id = hold(s, [0.5, 0.5], [0, 0], id, true)
  expect(s.getSnapshot().collection?.holds).toHaveLength(1)
  hold(s, [0.15, 0.85], [-0.35, 0.35], id, true)
  expect(s.getSnapshot().collection?.holds).toHaveLength(2)
})

test("changing calibration method cancels a partial hold and invalidates its result", () => {
  const s = new SceneSession()
  s.startCapture("calibration")
  hold(s, [0.5, 0.5], [0, 0])
  s.setMethod("marker")
  expect(s.getSnapshot().capture).toBeNull()
  expect(s.getSnapshot().collection).toBeNull()
  expect(s.getSnapshot().calibration).toBeNull()
})

test("marker mode completes automatic mapping and five fresh checks without hand landmarks or manual locking", () => {
  const s = new SceneSession("marker")
  s.startCapture("calibration")
  let id = 0
  for (const [x, y] of [...CALIBRATION_TARGETS, ...VALIDATION_TARGETS])
    id = hold(s, [x, y], [x - 0.5, y - 0.5], id, true)
  expect(s.getSnapshot().capture).toBeNull()
  expect(s.getSnapshot().calibration?.holds).toHaveLength(9)
  expect(s.getSnapshot().calibration?.method).toBe("marker")
  expect(s.getSnapshot().validation?.passed).toBe(true)
  expect(s.getSnapshot().validation?.holds).toBe(5)
})

test("hand and marker references share the same mapping and independent accuracy calculation", () => {
  const hand = new SceneSession("hand")
  const marker = new SceneSession("marker")
  hand.startCapture("calibration")
  marker.startCapture("calibration")
  let id = 0
  for (const [x, y] of [...CALIBRATION_TARGETS, ...VALIDATION_TARGETS]) {
    const feature: [number, number] = [
      0.04 - 1.1 * (x - 0.5) + 0.15 * (y - 0.5),
      -0.03 + 0.08 * (x - 0.5) + 0.9 * (y - 0.5),
    ]
    hold(hand, [x, y], feature, id)
    id = hold(marker, [x, y], feature, id, true)
  }
  for (const session of [hand, marker]) {
    const snapshot = session.getSnapshot()
    expect(snapshot.capture).toBeNull()
    expect(snapshot.calibration?.holds).toHaveLength(9)
    expect(snapshot.validation?.passed).toBe(true)
    expect(snapshot.validation?.holds).toBe(5)
    const prediction = mapSceneGaze(snapshot.calibration!, [-0.1375, -0.2266])!
    expect(prediction[0]).toBeCloseTo(0.63, 7)
    expect(prediction[1]).toBeCloseTo(0.27, 7)
  }
  expect(hand.getSnapshot().validation?.pixelRms).toBeCloseTo(
    marker.getSnapshot().validation!.pixelRms,
    7
  )
  expect(hand.getSnapshot().validation?.maxPixelError).toBeCloseTo(
    marker.getSnapshot().validation!.maxPixelError,
    7
  )
})

test("one-point estimates still suppress stale scene frames and lost pupils, and exports identify their quality", () => {
  const s = new SceneSession("one-point")
  s.startCapture("calibration")
  const id = hold(s, [0.5, 0.5], [0, 0])
  const timestamp = (id + 1) * 50
  s.addEye({
    id: id + 1,
    timestamp,
    feature: [0.2, 0],
    confidence: 0.95,
    valid: true,
  })
  const scene = {
    id: id + 1,
    timestamp,
    width: 640,
    height: 480,
    generation: 1,
  }
  s.measure(scene, timestamp)
  const log = createSessionLog(timestamp - 1, {
    calibrationMethod: "one-point",
  })
  appendMeasurement(log, s.getSnapshot().measurement!)
  const [header, row] = exportSessionCsv(log).trim().split("\n")
  const fields = header.split(",")
  const values = row.split(",")
  expect(values[fields.indexOf("estimated")]).toBe("1")
  expect(values[fields.indexOf("preview")]).toBe("0")
  expect(JSON.parse(exportSessionJson(log)).measurements[0].estimated).toBe(
    true
  )
  s.measure(scene, timestamp + 400)
  expect(s.getSnapshot().measurement?.position).toBeNull()
  expect(s.getSnapshot().measurement?.valid).toBe(false)
  s.addEye({
    id: id + 2,
    timestamp: timestamp + 450,
    feature: null,
    confidence: 0,
    valid: false,
  })
  s.measure(
    { ...scene, id: id + 2, timestamp: timestamp + 450 },
    timestamp + 450
  )
  expect(s.getSnapshot().measurement?.position).toBeNull()
  expect(s.getSnapshot().measurement?.valid).toBe(false)
})

test("invalid one-point gains are rejected and a deliberate negative gain reverses a fresh estimate", () => {
  const s = new SceneSession("one-point")
  s.startCapture("calibration")
  const id = hold(s, [0.5, 0.5], [0, 0])
  const original = s.getSnapshot().calibration
  s.setOnePointGain([NaN, 0])
  expect(s.getSnapshot().calibration).toBe(original)
  s.setOnePointGain([-1, 1])
  s.addEye({
    id: id + 1,
    timestamp: (id + 1) * 50,
    feature: [0.2, 0.1],
    confidence: 0.95,
    valid: true,
  })
  s.measure(
    {
      id: id + 1,
      timestamp: (id + 1) * 50,
      width: 640,
      height: 480,
      generation: 1,
    },
    (id + 1) * 50
  )
  expect(s.getSnapshot().measurement!.position).toEqual([0.7, 0.6])
  expect(s.getSnapshot().validation).toBeNull()
})
