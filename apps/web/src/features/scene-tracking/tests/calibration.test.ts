import { expect, test } from "bun:test"
import {
  pairObservation,
  inspectReferenceObservation,
  createCollector,
  lockCalibrationPoint,
  CALIBRATION_TARGETS,
  VALIDATION_TARGETS,
  collectPair,
  fitSceneCalibration,
  inspectSceneCalibration,
  mapSceneGaze,
  validateSceneCalibration,
} from "../features/scene-eye-tracking/calibration"
import type {
  CalibrationPair,
  CalibrationHold,
  HandObservation,
} from "../features/scene-eye-tracking/scene.types"

// Earlier fixtures edit hold summaries to describe their synthetic fixation.
// Keep their raw evidence consistent with that synthetic observation.
function validateSummarizedFixture(
  ...args: Parameters<typeof validateSceneCalibration>
) {
  const [calibration, samples, offset] = args
  return validateSceneCalibration(
    calibration,
    samples.map((hold) => ({
      ...hold,
      pairs: hold.pairs.map((pair) => ({
        ...pair,
        feature: hold.feature,
        target: hold.target,
      })),
    })),
    offset
  )
}
function hand(time = 1000, count = 1): HandObservation {
  return {
    scene: { id: 1, timestamp: time, width: 640, height: 480, generation: 1 },
    landmarks: Array.from({ length: count }, () =>
      Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
    ),
    worldLandmarks: [],
    handedness: ["Right"],
  }
}
const eye = {
  id: 1,
  timestamp: 990,
  feature: [0.1, 0.2] as [number, number],
  confidence: 0.9,
  valid: true,
}
function pair(id: number, time: number, x = 0.5, y = 0.5): CalibrationPair {
  return {
    eyeId: id,
    sceneId: id,
    eyeTimestamp: time,
    sceneTimestamp: time,
    feature: [x - 0.5, y - 0.5],
    target: [x, y],
    handedness: "Right",
    width: 640,
    height: 480,
  }
}
function holds(quadratic = false): CalibrationHold[] {
  return Array.from({ length: 9 }, (_, i) => {
    const x = [0.15, 0.5, 0.85][i % 3],
      y = [0.15, 0.5, 0.85][Math.floor(i / 3)]
    const feature: [number, number] = [x - 0.5, y - 0.5]
    const target: [number, number] = quadratic
      ? [x + 0.18 * feature[0] * feature[1], y + 0.15 * feature[0] ** 2]
      : [x, y]
    return { region: i, feature, target, pairs: [pair(i + 1, 1000, x, y)] }
  })
}

test("pairs nearest fresh eye evidence after relative camera delay adjustment", () => {
  expect(
    pairObservation([eye, { ...eye, id: 2, timestamp: 1100 }], hand(), 0, 1100)
      ?.eyeId
  ).toBe(1)
  expect(
    pairObservation([{ ...eye, timestamp: 850 }], hand(), 150, 1100)?.eyeId
  ).toBe(1)
  expect(pairObservation([eye], hand(), NaN, 1100)).toBeNull()
})
test("rejects stale, low-confidence, invalid, ambiguous and out-of-frame observations", () => {
  expect(pairObservation([eye], hand(), 0, 1300)).toBeNull()
  expect(
    pairObservation([{ ...eye, confidence: 0.69 }], hand(), 0, 1100)
  ).toBeNull()
  expect(
    pairObservation([{ ...eye, valid: false }], hand(), 0, 1100)
  ).toBeNull()
  expect(
    pairObservation([{ ...eye, feature: [NaN, 0] }], hand(), 0, 1100)
  ).toBeNull()
  expect(pairObservation([eye], hand(1000, 2), 0, 1100)).toBeNull()
  const outside = hand()
  outside.landmarks[0][8].x = 1.1
  expect(pairObservation([eye], outside, 0, 1100)).toBeNull()
  expect(
    pairObservation([{ ...eye, timestamp: 800 }], hand(), 0, 1100)
  ).toBeNull()
})
test("settles and collects unique pairs; duplicate frames do not finish a hold", () => {
  const c = createCollector("calibration")
  lockCalibrationPoint(c)
  for (let i = 0; i < 40; i++) collectPair(c, pair(1, 1000))
  expect(c.holds).toHaveLength(0)
  for (let i = 2; i < 30; i++) collectPair(c, pair(i, 1000 + i * 50))
  expect(c.holds).toHaveLength(1)
  for (let i = 30; i < 65; i++) collectPair(c, pair(i, 1000 + i * 50))
  expect(c.holds).toHaveLength(1)
})
test("a steady fingertip and pupil cannot record a location before the user locks it", () => {
  const c = createCollector("calibration")
  for (let id = 1; id <= 40; id++) collectPair(c, pair(id, id * 50))
  expect(c.holds).toHaveLength(0)
  expect(c.pending).toHaveLength(0)
})
test("the lock action stays available during a brief hand miss without recording cached coordinates", () => {
  const c = createCollector("calibration")
  expect(collectPair(c, pair(1, 100)).canLock).toBe(true)
  expect(collectPair(c, null, 150).canLock).toBe(true)
  lockCalibrationPoint(c)
  collectPair(c, null, 200)
  expect(c.holds).toHaveLength(0)
  expect(c.pending).toHaveLength(0)
  expect(collectPair(c, null, 600).canLock).toBe(false)
})
test("a grossly inconsistent calibration location is rejected instead of accepting a loose fit", () => {
  const samples = holds()
  samples[0].target[0] += 0.18
  expect(fitSceneCalibration(samples)).toBeNull()
  expect(inspectSceneCalibration(samples).previewCalibration).toBeDefined()
})
test("bounded collection noise proceeds to independent checks instead of blaming a single point", () => {
  const offsets = [0, 1, -1, 1, -1, 1, -1, 1, -1]
  const samples = CALIBRATION_TARGETS.map(([x, y], index) => ({
    region: Math.floor(y * 3) * 3 + Math.floor(x * 3),
    feature: [x - 0.5, y - 0.5] as [number, number],
    target: [x + offsets[index] * 0.048, y] as [number, number],
    pairs: [pair(index + 1, 1000, x, y)],
  }))
  const result = inspectSceneCalibration(samples)
  expect(result.calibration).not.toBeNull()
  expect(result.retryIndex).toBeNull()
  const calibration = result.calibration!
  expect(calibration.holds).toHaveLength(9)
  expect(calibration.trainingRms).toBeGreaterThan(0.025)
  expect(calibration.maxTrainingError).toBeLessThan(0.05)

  const checks = VALIDATION_TARGETS.map(([x, y], index) => ({
    region: index,
    feature: [x - 0.5, y - 0.5] as [number, number],
    target: [x, y] as [number, number],
    pairs: [pair(100 + index, 2000, x, y)],
  }))
  expect(validateSummarizedFixture(calibration, checks)?.passed).toBe(true)
  const shiftedChecks = checks.map((hold) => ({
    ...hold,
    feature: [hold.feature[0] + 0.08, hold.feature[1]] as [number, number],
  }))
  expect(validateSummarizedFixture(calibration, shiftedChecks)?.passed).toBe(
    false
  )
})
test("validation cannot hide one inaccurate location inside a good average", () => {
  const calibration = fitSceneCalibration(holds())!
  const fresh = holds().slice(0, 5)
  fresh[0].target[0] += 0.055
  expect(validateSummarizedFixture(calibration, fresh)?.passed).toBe(false)
})
test("failed validation diagnoses a constant shift without treating its fitted correction as an independent pass", () => {
  const calibration = fitSceneCalibration(holds())!
  const fresh = holds()
    .slice(0, 5)
    .map((h) => ({
      ...h,
      feature: [h.feature[0] + 0.06, h.feature[1] - 0.04] as [number, number],
    }))
  const result = validateSummarizedFixture(calibration, fresh)!
  expect(result.passed).toBe(false)
  expect(result.points).toHaveLength(5)
  expect(result.points[0].pixelDelta[0]).toBeCloseTo(38.4)
  expect(result.points[0].pixelDelta[1]).toBeCloseTo(-19.2)
  expect(result.suggestedOffset?.[0]).toBeCloseTo(-0.06)
  expect(result.suggestedOffset?.[1]).toBeCloseTo(0.04)
  expect(result.retryIndex).toBeNull()
  const corrected = validateSummarizedFixture(
    calibration,
    fresh,
    result.suggestedOffset!
  )!
  expect(corrected.passed).toBe(true)
  expect(corrected.pixelRms).toBeLessThan(1e-6)
})
test("direction-dependent validation error cannot be disguised as a constant offset", () => {
  const calibration = fitSceneCalibration(holds())!
  const fresh = holds()
    .slice(0, 5)
    .map((h, i) => ({
      ...h,
      feature: [h.feature[0] + (i % 2 ? 0.08 : -0.08), h.feature[1]] as [
        number,
        number,
      ],
    }))
  const result = validateSummarizedFixture(calibration, fresh)!
  expect(result.passed).toBe(false)
  expect(result.suggestedOffset).toBeNull()
  expect(result.retryIndex).toBeNull()
})
test("validation identifies one failed location while retaining per-point evidence", () => {
  const calibration = fitSceneCalibration(holds())!
  const fresh = holds().slice(0, 5)
  fresh[2].feature[0] += 0.14
  const result = validateSummarizedFixture(calibration, fresh)!
  expect(result.passed).toBe(false)
  expect(result.retryIndex).toBe(2)
  expect(result.suggestedOffset).toBeNull()
  expect(result.points[2].pixelError).toBeCloseTo(89.6)
  expect(result.points[2].target).toEqual(fresh[2].target)
})
test("a blink clears an incomplete hold", () => {
  const c = createCollector("calibration")
  lockCalibrationPoint(c)
  for (let id = 1; id <= 12; id++) collectPair(c, pair(id, id * 50))
  collectPair(c, null)
  expect(c.pending).toHaveLength(0)
  expect(c.holds).toHaveLength(0)
})
test("sustained fingertip or gaze movement starts a new hold", () => {
  for (const kind of ["fingertip", "gaze"] as const) {
    const c = createCollector("calibration")
    lockCalibrationPoint(c)
    for (let id = 1; id <= 12; id++) collectPair(c, pair(id, id * 50))
    for (let id = 13; id <= 18; id++)
      collectPair(c, {
        ...pair(id, id * 50),
        ...(kind === "fingertip"
          ? { target: [0.53, 0.5] as [number, number] }
          : { feature: [0.05, 0] as [number, number] }),
      })
    expect(c.pending).toHaveLength(0)
    expect(c.holds).toHaveLength(0)
    for (let id = 19; id <= 45; id++)
      collectPair(c, {
        ...pair(id, id * 50),
        ...(kind === "fingertip"
          ? { target: [0.53, 0.5] as [number, number] }
          : { feature: [0.05, 0] as [number, number] }),
      })
    expect(c.holds).toHaveLength(1)
    expect(c.holds[0].pairs.every((p) => p.sceneId > 18)).toBe(true)
  }
})
test("a brief detector outlier pauses capture and preserves earlier real samples", () => {
  for (const kind of ["fingertip", "gaze", "outside ring"] as const) {
    const c = createCollector("calibration")
    lockCalibrationPoint(c)
    let before = collectPair(c, pair(1, 50))
    for (let id = 2; id <= 12; id++) before = collectPair(c, pair(id, id * 50))
    const outlier = collectPair(c, {
      ...pair(13, 650),
      ...(kind === "gaze"
        ? { feature: [0.05, 0] as [number, number] }
        : {
            target: [kind === "fingertip" ? 0.53 : 0.8, 0.5] as [
              number,
              number,
            ],
          }),
    })
    expect(outlier.status).toBe("paused")
    expect(outlier.progress).toBe(before.progress)
    expect(outlier.samples).toBe(before.samples)
    for (let id = 14; id <= 30; id++) collectPair(c, pair(id, id * 50))
    expect(c.holds).toHaveLength(1)
    expect(c.holds[0].pairs.some((p) => p.sceneId === 13)).toBe(false)
    expect(c.holds[0].pairs.some((p) => p.sceneId === 7)).toBe(true)
  }
})
test("the saved point reports completed progress after its pending samples are cleared", () => {
  const c = createCollector("calibration")
  lockCalibrationPoint(c)
  let result = collectPair(c, pair(1, 50))
  for (let id = 2; id <= 26; id++) result = collectPair(c, pair(id, id * 50))
  expect(result.status).toBe("saved")
  expect(result.progress).toBe(1)
  expect(result.samples).toBe(20)
})
test("handedness classification jitter cannot erase a stationary confirmed fingertip", () => {
  const c = createCollector("calibration")
  lockCalibrationPoint(c)
  for (let id = 1; id <= 35; id++)
    collectPair(c, {
      ...pair(id, id * 50),
      handedness: id % 2 ? "Right" : "Left",
    })
  expect(c.holds).toHaveLength(1)
})
test("the same small angular eye jitter is accepted at the center and at an extreme gaze angle", () => {
  for (const [x, y] of [
    [0, 0],
    [1.2, -1.2],
  ]) {
    const c = createCollector("calibration")
    lockCalibrationPoint(c)
    for (let id = 1; id <= 35; id++) {
      // Rotate the physical gaze ray by +/- 0.4 degrees about its vertical axis.
      // Projecting that ray into slope coordinates exaggerates edge jitter.
      const angle = id % 2 ? 0.007 : -0.007
      const cosine = Math.cos(angle),
        sine = Math.sin(angle)
      collectPair(c, {
        ...pair(id, id * 50),
        feature: [
          (x * cosine - sine) / (x * sine + cosine),
          y / (x * sine + cosine),
        ],
      })
    }
    expect(c.holds).toHaveLength(1)
  }
})
test("a brief missing hand pauses a hold without inserting or counting missing evidence", () => {
  const c = createCollector("calibration")
  lockCalibrationPoint(c)
  for (let id = 1; id <= 12; id++) collectPair(c, pair(id, id * 50))
  const before = c.pending.length
  const progress = collectPair(c, null, 650).progress
  expect(c.pending).toHaveLength(before)
  expect(progress).toBeGreaterThan(0)
  for (let id = 14; id <= 24; id++) collectPair(c, pair(id, id * 50))
  expect(c.holds).toHaveLength(0)
  for (let id = 25; id <= 30; id++) collectPair(c, pair(id, id * 50))
  expect(c.holds).toHaveLength(1)
  expect(c.holds[0].pairs.some((p) => p.sceneId === 13)).toBe(false)
})
test("long hand loss or sustained returning fingertip movement clears the paused hold", () => {
  for (const resumed of [pair(22, 1100), pair(14, 700, 0.52, 0.52)]) {
    const c = createCollector("calibration")
    lockCalibrationPoint(c)
    for (let id = 1; id <= 12; id++) collectPair(c, pair(id, id * 50))
    collectPair(c, null, 650)
    collectPair(c, resumed)
    if (resumed.sceneId === 14)
      for (let id = 15; id <= 18; id++)
        collectPair(c, pair(id, id * 50, 0.52, 0.52))
    expect(c.pending).toHaveLength(0)
    expect(c.holds).toHaveLength(0)
  }
})
test("calibration requires nine regions; validation requires five distinct regions", () => {
  for (const mode of ["calibration", "validation"] as const) {
    const c = createCollector(mode)
    let id = 0,
      time = 0
    const targets =
      mode === "calibration" ? CALIBRATION_TARGETS : VALIDATION_TARGETS
    const count = targets.length
    for (let region = 0; region < count; region++) {
      lockCalibrationPoint(c)
      for (let i = 0; i < 30; i++)
        collectPair(
          c,
          pair(++id, (time += 50), targets[region][0], targets[region][1])
        )
    }
    expect(c.holds).toHaveLength(count)
    expect(collectPair(c, null).complete).toBe(true)
  }
})
test("fits affine mapping with whole-location held-out error and unclamped output", () => {
  const fit = fitSceneCalibration(holds())!
  expect(fit.model).toBe("affine")
  expect(fit.crossValidationRms).toBeLessThan(1e-8)
  expect(mapSceneGaze(fit, [0.1, -0.2])![0]).toBeCloseTo(0.6, 7)
  expect(mapSceneGaze(fit, [2, 0])![0]).toBeGreaterThan(1)
  expect(mapSceneGaze(fit, [NaN, 0])).toBeNull()
})
test("selects quadratic mapping only when held-out accuracy improves", () => {
  const fit = fitSceneCalibration(holds(true))!
  expect(fit.model).toBe("quadratic")
  expect(fit.crossValidationRms).toBeLessThan(1e-8)
  expect(mapSceneGaze(fit, [0.2, -0.2])![0]).toBeCloseTo(0.7 - 0.0072, 7)
})
test("exact perspective camera mappings fit and generalize to fresh validation points", () => {
  const strength = 1.5
  const samples = holds().map((h) => ({
    ...h,
    feature: [
      (h.target[0] - 0.5) / (1 + strength * (h.target[0] - 0.5)),
      (h.target[1] - 0.5) / (1 + strength * (h.target[0] - 0.5)),
    ] as [number, number],
  }))
  const fit = fitSceneCalibration(samples)
  expect(fit).not.toBeNull()
  expect(fit!.model).toBe("projective")
  expect(fit!.crossValidationRms).toBeLessThan(1e-8)
  const fresh = VALIDATION_TARGETS.map(([x, y], index) => ({
    region: index,
    target: [x, y] as [number, number],
    feature: [
      (x - 0.5) / (1 + strength * (x - 0.5)),
      (y - 0.5) / (1 + strength * (x - 0.5)),
    ] as [number, number],
    pairs: [pair(index + 1, 1000, x, y)],
  }))
  expect(validateSummarizedFixture(fit!, fresh)?.passed).toBe(true)
  expect(validateSummarizedFixture(fit!, fresh)?.normalizedRms).toBeLessThan(
    1e-8
  )
})
test("rejects missing regions, poor scene coverage, collapsed features and corrupt samples", () => {
  expect(fitSceneCalibration(holds().slice(0, 8))).toBeNull()
  expect(
    fitSceneCalibration(holds().map((h) => ({ ...h, feature: [0, 0] })))
  ).toBeNull()
  expect(
    fitSceneCalibration(
      holds().map((h) => ({ ...h, feature: [h.feature[0], h.feature[0]] }))
    )
  ).toBeNull()
  expect(
    fitSceneCalibration(holds().map((h) => ({ ...h, target: [0.5, 0.5] })))
  ).toBeNull()
  const corrupt = holds()
  corrupt[0].feature[0] = Infinity
  expect(fitSceneCalibration(corrupt)).toBeNull()
})
test("a projective horizon or corrupt denominator cannot produce a gaze position", () => {
  const fit = {
    model: "projective" as const,
    mean: [0, 0] as [number, number],
    scale: [1, 1] as [number, number],
    coefficients: [
      [0.5, 1, 0],
      [0.5, 0, 1],
    ] as [number[], number[]],
    denominator: [1, 0] as [number, number],
  }
  expect(mapSceneGaze(fit, [-1, 0])).toBeNull()
  expect(mapSceneGaze(fit, [-2, 0])).toBeNull()
  expect(mapSceneGaze({ ...fit, denominator: [NaN, 0] }, [0, 0])).toBeNull()
  expect(mapSceneGaze({ ...fit, denominator: undefined }, [0, 0])).toBeNull()
})
test("independent validation reports normalized and pixel RMS and failure", () => {
  const fit = fitSceneCalibration(holds())!
  const fresh = holds()
    .slice(0, 5)
    .map((h) => ({
      ...h,
      target: [h.target[0] + 0.02, h.target[1]] as [number, number],
    }))
  const result = validateSummarizedFixture(fit, fresh)!
  expect(result.normalizedRms).toBeCloseTo(0.02, 7)
  expect(result.pixelRms).toBeCloseTo(12.8, 7)
  expect(result.passed).toBe(true)
  expect(
    validateSummarizedFixture(
      fit,
      fresh.map((h) => ({ ...h, target: [h.target[0] + 0.2, h.target[1]] }))
    )!.passed
  ).toBe(false)
})

test("rejects nonfinite scene timing and any corrupt hand joint", () => {
  const corruptTime = hand(NaN)
  expect(pairObservation([eye], corruptTime, 0, 1100)).toBeNull()
  const corruptHand = hand()
  corruptHand.landmarks[0][0].x = NaN
  expect(pairObservation([eye], corruptHand, 0, 1100)).toBeNull()
})

function distortedHolds(
  targets: readonly [number, number][],
  firstId: number
): CalibrationHold[] {
  return targets.map(([u, v], index) => {
    // A stable perspective response plus mild cross-axis lens distortion.
    const x = u - 0.5,
      y = v - 0.5
    const feature: [number, number] = [
      x / (1 + x) + 0.5 * x * y * y,
      y / (1 + x) + 0.5 * y * x * x,
    ]
    const evidence = { ...pair(firstId + index, firstId * 50, u, v), feature }
    return {
      region: Math.floor(v * 3) * 3 + Math.floor(u * 3),
      target: [u, v],
      feature,
      pairs: [evidence],
    }
  })
}
test("stable distorted perspective holds reach fresh checks despite corner extrapolation error", () => {
  const samples = distortedHolds(CALIBRATION_TARGETS, 1)
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = inspectSceneCalibration(samples)
    expect(result.calibration).not.toBeNull()
    expect(result.retryIndex).toBeNull()
    const fit = result.calibration!
    expect(fit.model).toBe("projective")
    expect(fit.trainingRms).toBeLessThan(0.025)
    expect(fit.maxTrainingError).toBeLessThan(0.05)
    expect(fit.crossValidationRms).toBeGreaterThan(0.025)
    expect(fit.maxValidationError).toBeGreaterThan(0.05)
    const validation = validateSummarizedFixture(
      fit,
      distortedHolds(VALIDATION_TARGETS, 100)
    )!
    expect(validation.passed).toBe(true)
    expect(validation.normalizedRms).toBeLessThan(0.01)
    expect(validation.maxNormalizedError).toBeLessThan(0.01)
  }
})
test("training consistency does not bypass a gaze shift in fresh checks", () => {
  const samples = holds()
  samples[0].target[0] += 0.15
  const calibration = fitSceneCalibration(samples)
  expect(calibration).not.toBeNull()
  expect(calibration!.trainingRms).toBeLessThan(0.025)
  const fresh = VALIDATION_TARGETS.map(([x, y], index) => ({
    region: index,
    target: [x, y] as [number, number],
    feature: [x - 0.5 + 0.08, y - 0.5] as [number, number],
    pairs: [pair(100 + index, 2000, x, y)],
  }))
  expect(validateSummarizedFixture(calibration!, fresh)?.passed).toBe(false)
})

test("a marker reference pairs with fresh eyes without fabricating a hand", () => {
  const reference = {
    scene: hand().scene,
    position: [0.3, 0.4] as [number, number],
    kind: "marker" as const,
  }
  const result = inspectReferenceObservation([eye], reference, 0, 1100)
  expect(result?.pair?.target).toEqual([0.3, 0.4])
  expect(result?.pair?.eyeId).toBe(1)
  expect(result?.pair?.sceneId).toBe(1)
  expect(result?.issue).toBeNull()
})
test("reference pairing preserves timing, confidence and coordinate safety checks", () => {
  const reference = {
    scene: hand().scene,
    position: [0.3, 0.4] as [number, number],
    kind: "marker" as const,
  }
  for (const value of [
    { ...reference, position: null },
    { ...reference, position: [NaN, 0.4] as [number, number] },
    { ...reference, position: [1.2, 0.4] as [number, number] },
  ]) {
    const result = inspectReferenceObservation([eye], value, 0, 1100)
    expect(result?.pair).toBeNull()
    expect(result?.issue?.canPause).toBe(false)
  }
  // Delayed frames never become samples, but may pause an existing hold.
  const delayed = inspectReferenceObservation(
    [eye],
    { ...reference, scene: { ...reference.scene, timestamp: 700 } },
    0,
    1100
  )
  expect(delayed.pair).toBeNull()
  expect(delayed.issue?.canPause).toBe(true)
  expect(
    inspectReferenceObservation([{ ...eye, valid: false }], reference, 0, 1100)
      ?.pair
  ).toBeNull()
  expect(
    inspectReferenceObservation(
      [{ ...eye, confidence: 0.69 }],
      reference,
      0,
      1100
    )?.pair
  ).toBeNull()
  expect(
    inspectReferenceObservation(
      [{ ...eye, timestamp: 800 }],
      reference,
      0,
      1100
    )?.pair
  ).toBeNull()
  expect(
    inspectReferenceObservation([eye], reference, NaN, 1100)?.pair
  ).toBeNull()
})
test("a collector follows an explicit target sequence and completes at its target count", () => {
  const c = createCollector("validation", [
    [0.15, 0.15],
    [0.85, 0.85],
  ])
  let result = collectPair(c, pair(1, 50, 0.15, 0.15))
  expect(result.target).toEqual([0.15, 0.15])
  expect(result.canLock).toBe(true)
  lockCalibrationPoint(c)
  for (let id = 2; id <= 27; id++)
    result = collectPair(c, pair(id, id * 50, 0.15, 0.15))
  expect(result.complete).toBe(false)
  expect(result.target).toEqual([0.85, 0.85])
  lockCalibrationPoint(c)
  for (let id = 28; id <= 53; id++)
    result = collectPair(c, pair(id, id * 50, 0.85, 0.85))
  expect(result.complete).toBe(true)
  expect(result.holds).toHaveLength(2)
})
test("an empty target list permits one manual free-position reference", () => {
  const c = createCollector("calibration", [])
  c.freeTarget = true
  let result = collectPair(c, pair(1, 50, 0.24, 0.72))
  expect(result.complete).toBe(false)
  expect(result.canLock).toBe(true)
  expect(result.target).toBeNull()
  expect(c.holds).toHaveLength(0)
  lockCalibrationPoint(c)
  for (let id = 2; id <= 27; id++)
    result = collectPair(c, pair(id, id * 50, 0.24, 0.72))
  expect(result.complete).toBe(true)
  expect(result.holds).toHaveLength(1)
  expect(result.canLock).toBe(false)
})

test("automatic reference capture still requires real stable paired evidence", () => {
  const c = createCollector("calibration", [[0.5, 0.5]])
  c.automatic = true
  for (let id = 1; id <= 5; id++) collectPair(c, pair(id, id * 50, 0.1, 0.1))
  expect(c.holds).toHaveLength(0)
  expect(c.armed).toBe(false)
  for (let id = 6; id <= 31; id++) collectPair(c, pair(id, id * 50))
  expect(c.holds).toHaveLength(1)
  expect(c.holds[0].pairs).toHaveLength(20)
})

test("validation scores raw jitter even when hold summaries are exact", () => {
  const calibration = fitSceneCalibration(holds())!
  const fresh = holds()
    .slice(0, 5)
    .map((hold) => ({
      ...hold,
      pairs: Array.from({ length: 20 }, (_, i) => ({
        ...hold.pairs[0],
        feature: [
          hold.feature[0] + (i % 2 ? 0.09 : -0.09),
          hold.feature[1],
        ] as [number, number],
      })),
    }))
  const result = validateSceneCalibration(calibration, fresh)!
  expect(result.passed).toBe(false)
  expect(result.normalizedRms).toBeCloseTo(0.09)
  expect(result.pixelRms).toBeCloseTo(57.6)
  expect(result.suggestedOffset).toBeNull()
})

test("validation balances targets and uses each raw pair's target and image dimensions", () => {
  const calibration = fitSceneCalibration(holds())!
  const fresh = holds()
    .slice(0, 5)
    .map((hold, index) => ({
      ...hold,
      pairs: Array.from({ length: index === 0 ? 2 : 20 }, () => ({
        ...hold.pairs[0],
        target: [hold.target[0] + (index === 0 ? 0.08 : 0), hold.target[1]] as [
          number,
          number,
        ],
        width: 800,
      })),
    }))
  const result = validateSceneCalibration(calibration, fresh)!
  expect(result.normalizedRms).toBeCloseTo(Math.sqrt(0.08 ** 2 / 5))
  expect(result.pixelRms).toBeCloseTo(Math.sqrt(64 ** 2 / 5))
  expect(result.maxNormalizedError).toBeCloseTo(0.08)
  expect(result.maxPixelError).toBeCloseTo(64)
  expect(result.pairs).toBe(82)
  expect(result.passed).toBe(false)
  fresh[1].pairs[0].width = NaN
  expect(validateSceneCalibration(calibration, fresh)).toBeNull()
})
