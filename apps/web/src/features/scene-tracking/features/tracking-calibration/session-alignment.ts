import { fitScreenCoordinates } from "../eye-tracking/calibration-least-squares"
import { applyAffineMapping } from "../eye-tracking/calibration-mapping"
import { evaluateValidation } from "./validation-metrics"
import type {
  ValidationReading,
  ValidationViewport,
} from "./validation-metrics.types"
import type {
  AlignmentMethod,
  AlignmentPoint,
  AlignmentSample,
  PersonalResidualResult,
  ReturnCheckResult,
  SessionAlignment,
} from "./session-alignment.types"
export const RETURN_CHECK_TARGETS: AlignmentPoint[] = [
  [0.3, 0.35],
  [0.7, 0.35],
  [0.5, 0.7],
]
export const PERSONAL_RESIDUAL_TARGETS: AlignmentPoint[] = [
  [0.5, 0.5],
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
]
function averageTargets(samples: AlignmentSample[]): AlignmentSample[] {
  const groups = new Map<string, AlignmentSample[]>()
  let timestamp = -Infinity
  for (const sample of samples) {
    if (
      ![...sample.predicted, ...sample.target, sample.timestamp].every(
        Number.isFinite
      ) ||
      sample.timestamp <= timestamp
    ) {
      continue
    }
    timestamp = sample.timestamp
    const key = JSON.stringify([sample.targetId, sample.target])
    const group = groups.get(key) ?? []
    group.push(sample)
    groups.set(key, group)
  }
  return Array.from(groups.values(), (group) => {
    const predicted: AlignmentPoint = [0, 0]
    for (const sample of group) {
      predicted[0] += sample.predicted[0] / group.length
      predicted[1] += sample.predicted[1] / group.length
    }
    return { ...group[0]!, predicted }
  })
}
export function fitSessionAlignment(
  samples: AlignmentSample[],
  method: AlignmentMethod
): SessionAlignment | null {
  const targets = averageTargets(samples)
  if (!targets.length) {
    return null
  }
  if (method === "translation") {
    const offset: AlignmentPoint = [0, 0]
    for (const sample of targets) {
      offset[0] += (sample.target[0] - sample.predicted[0]) / targets.length
      offset[1] += (sample.target[1] - sample.predicted[1]) / targets.length
    }
    if (offset.some((value) => Math.abs(value) > 1)) {
      return null
    }
    return { method, offset, targetCount: targets.length, verified: false }
  }
  if (targets.length < 3) {
    return null
  }
  const solution = fitScreenCoordinates(
    targets.map((sample) => [1, ...sample.predicted]),
    targets.map((sample) => sample.target)
  )
  if (!solution) {
    return null
  }
  return {
    method,
    coefficients: solution,
    targetCount: targets.length,
    verified: false,
  }
}
export function applySessionAlignment(
  point: AlignmentPoint,
  alignment: SessionAlignment
): AlignmentPoint | null {
  if (!point.every(Number.isFinite)) {
    return null
  }
  if (alignment.method === "affine") {
    return applyAffineMapping(alignment.coefficients, point)
  }
  return [point[0] + alignment.offset[0], point[1] + alignment.offset[1]]
}
/** Fit an offset on two target groups; the third group never participates in fitting. */
export function evaluateReturnCheck(
  readings: ValidationReading[],
  viewport: ValidationViewport
): ReturnCheckResult {
  const baseline = evaluateValidation(readings, viewport)
  const failed = {
    offset: null,
    metrics: baseline,
    corrected: false,
    issue: "Check incomplete. Keep your eyes visible and retry.",
  }
  if (
    baseline.attemptedTargetCount !== 3 ||
    baseline.targetCount !== 3 ||
    baseline.validFraction < 0.9 ||
    baseline.rmsPixels === null
  ) {
    return failed
  }
  const tolerance = Math.max(
    25,
    Math.hypot(viewport.width, viewport.height) * 0.025
  )
  if (
    baseline.targets.every(
      (target) => target.rmsPixels !== null && target.rmsPixels <= tolerance
    )
  ) {
    return { offset: [0, 0], metrics: baseline, corrected: false, issue: "" }
  }
  const targetIds = baseline.targets.map((target) => target.targetId)
  const training = readings
    .filter(
      (reading) =>
        reading.targetId !== targetIds[2] && reading.point && !reading.reason
    )
    .map((reading) => ({
      predicted: reading.point!,
      target: reading.target,
      targetId: reading.targetId,
      timestamp: reading.timestamp,
    }))
  const alignment = fitSessionAlignment(training, "translation")
  if (!alignment || alignment.method !== "translation") {
    return failed
  }
  const corrected = evaluateValidation(
    readings.map((reading) => ({
      ...reading,
      point: reading.point
        ? applySessionAlignment(reading.point, alignment)
        : null,
    })),
    viewport
  )
  if (
    !corrected.targets.every(
      (target) => target.rmsPixels !== null && target.rmsPixels <= tolerance
    ) ||
    corrected.rmsPixels === null ||
    corrected.rmsPixels >= baseline.rmsPixels
  ) {
    return {
      ...failed,
      issue:
        "Error varies across the screen. Keep this profile; recalibrate to repair the mapping.",
    }
  }
  return {
    offset: alignment.offset,
    metrics: corrected,
    corrected: true,
    issue: "",
  }
}

/** Only a compatible, already-calibrated base can enter this five-target experiment. */
export function evaluatePersonalResidual(
  readings: ValidationReading[],
  viewport: ValidationViewport,
  supportedBase: boolean
): PersonalResidualResult {
  const baseline = evaluateValidation(readings, viewport)
  const failed = {
    alignment: null,
    metrics: baseline,
    issue:
      "Grid repair needs a compatible base and five clear targets. Your accepted calibration is kept.",
  }
  if (
    !supportedBase ||
    baseline.targetCount !== 5 ||
    baseline.attemptedTargetCount !== 5 ||
    baseline.validFraction < 0.9
  ) {
    return failed
  }
  const fittingIds = baseline.targets
    .slice(0, 3)
    .map((target) => target.targetId)
  const training = readings
    .filter(
      (reading) =>
        fittingIds.includes(reading.targetId) &&
        reading.point &&
        !reading.reason
    )
    .map((reading) => ({
      predicted: reading.point!,
      target: reading.target,
      targetId: reading.targetId,
      timestamp: reading.timestamp,
    }))
  const alignment = fitSessionAlignment(training, "affine")
  if (!alignment) {
    return failed
  }
  const corrected = evaluateValidation(
    readings.map((reading) => ({
      ...reading,
      point: reading.point
        ? applySessionAlignment(reading.point, alignment)
        : null,
    })),
    viewport
  )
  const tolerance = Math.max(
    25,
    Math.hypot(viewport.width, viewport.height) * 0.025
  )
  if (
    !corrected.targets.every(
      (target) => target.rmsPixels !== null && target.rmsPixels <= tolerance
    )
  ) {
    return {
      ...failed,
      issue:
        "Grid repair did not pass the two independent targets. Your accepted calibration is kept.",
    }
  }
  return { alignment, metrics: corrected, issue: "" }
}
export function alignGazePoint(
  point: AlignmentPoint | null,
  alignment: SessionAlignment | null
): AlignmentPoint | null {
  if (!point) {
    return null
  }
  if (!alignment) {
    return point
  }
  return applySessionAlignment(point, alignment)
}
