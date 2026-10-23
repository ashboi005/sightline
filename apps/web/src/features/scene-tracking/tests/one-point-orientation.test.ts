import { expect, test } from "bun:test"
import { fitOnePointCalibration } from "../features/scene-eye-tracking/one-point-calibration"
import { mapSceneGaze } from "../features/scene-eye-tracking/calibration"
import type { CameraTransform } from "../features/eye-tracking/camera-transform"
import type { CalibrationHold } from "../features/scene-eye-tracking/scene.types"
import { gazeFeature } from "../features/eye-tracking/calibration"
import { gazeFromPupil } from "../features/eye-tracking/geometry"
import { gazeVector3D } from "../features/eye-tracking/manual-gaze-vector"

const plain: CameraTransform = { rotation: 0, mirrorX: false, mirrorY: false }
const hold: CalibrationHold = {
  region: 4,
  feature: [0, 0],
  target: [0.5, 0.5],
  pairs: [
    {
      eyeId: 1,
      sceneId: 1,
      eyeTimestamp: 100,
      sceneTimestamp: 100,
      feature: [0, 0],
      target: [0.5, 0.5],
      handedness: "Right",
      width: 640,
      height: 480,
    },
  ],
}

test("one-point uses the user's corrected front-facing eye and outward scene views without undoing their adjustments", () => {
  // These settings correct different raw camera mounts. Once corrected, the
  // wearer looking right/down moves the front-facing pupil left/down, and
  // the outward scene gaze right/down. The final view axes are authoritative.
  const orientations = [
    { eye: plain, scene: plain },
    { eye: plain, scene: { ...plain, mirrorX: true } },
    { eye: { ...plain, mirrorX: true }, scene: plain },
    { eye: { ...plain, rotation: 90 }, scene: plain },
    { eye: plain, scene: { ...plain, rotation: 90 } },
    {
      eye: { ...plain, rotation: 90, mirrorX: true },
      scene: { ...plain, rotation: 90, mirrorX: true },
    },
    {
      eye: { ...plain, rotation: 270, mirrorY: true },
      scene: { ...plain, rotation: 45, mirrorY: true },
    },
  ]
  const directions = [
    { feature: [-0.2, 0], want: [0.7, 0.5] }, // wearer right
    { feature: [0.2, 0], want: [0.3, 0.5] }, // wearer left
    { feature: [0, -0.1], want: [0.5, 0.4] }, // up
    { feature: [0, 0.1], want: [0.5, 0.6] }, // down
    { feature: [-0.2, 0.1], want: [0.7, 0.6] },
  ] as const
  for (const { eye, scene } of orientations) {
    const fit = fitOnePointCalibration(hold, null, [1, 1], { eye, scene })!
    for (const { feature, want } of directions) {
      const position = mapSceneGaze(fit.calibration, [...feature])!
      expect(position[0]).toBeCloseTo(want[0], 7)
      expect(position[1]).toBeCloseTo(want[1], 7)
    }
  }
})

test("manual and automatic eye geometry give the same physical one-point direction", () => {
  const fit = fitOnePointCalibration(hold, null, [1, 1])!.calibration
  const positions = [
    { pupil: [300, 240], axis: 0, side: 1 }, // front view left -> wearer right
    { pupil: [340, 240], axis: 0, side: -1 },
    { pupil: [320, 220], axis: 1, side: -1 },
    { pupil: [320, 260], axis: 1, side: 1 },
  ] as const
  for (const { pupil, axis, side } of positions) {
    const manual = gazeVector3D([...pupil], [320, 240], 100)
    const automatic = gazeFromPupil(
      [...pupil],
      { center: [0, 0, 100], radius: 12 },
      { fx: 500, fy: 500, cx: 320, cy: 240 }
    )!
    for (const direction of [
      [manual[0], manual[1], -manual[2]] as [number, number, number],
      automatic.direction,
    ]) {
      const position = mapSceneGaze(fit, gazeFeature(direction)!)!
      expect((position[axis] - 0.5) * side).toBeGreaterThan(0)
      expect(position[1 - axis]).toBeCloseTo(0.5, 7)
    }
  }
})

test("one-point anchors an off-center fixation without changing its directional relationship", () => {
  const offCenter = {
    ...hold,
    feature: [0.1, -0.2],
    target: [0.7, 0.3],
  } satisfies CalibrationHold
  const fit = fitOnePointCalibration(offCenter, null, [1, 1])!.calibration
  expect(mapSceneGaze(fit, [0.1, -0.2])).toEqual([0.7, 0.3])
  const position = mapSceneGaze(fit, [-0.1, -0.1])!
  expect(position[0]).toBeCloseTo(0.9, 7)
  expect(position[1]).toBeCloseTo(0.4, 7)
})

test("one-point orientation never applies a second transform to a previously fitted mapping", () => {
  const previous = fitOnePointCalibration(hold, null, [1, 1])!.calibration
  previous.coefficients = [
    [0.5, -1, 0.2],
    [0.5, 0.3, 0.8],
  ]
  const fit = fitOnePointCalibration(hold, previous, [1, 1], {
    eye: { ...plain, mirrorX: true },
    scene: { ...plain, rotation: 90 },
  })!
  const position = mapSceneGaze(fit.calibration, [0.2, 0.1])!
  expect(position[0]).toBeCloseTo(0.32, 7)
  expect(position[1]).toBeCloseTo(0.64, 7)
})
