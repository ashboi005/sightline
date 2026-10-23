import type {
  ScoredValidationPoint,
  ValidationAccuracy,
  ValidationMetrics,
  ValidationPoint,
  ValidationReading,
  ValidationViewport,
} from "./validation-metrics.types"

function finitePoint(point: ValidationPoint | null): point is ValidationPoint {
  return !!point && point.length === 2 && point.every(Number.isFinite)
}

function validViewport(viewport: ValidationViewport): boolean {
  return (
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0
  )
}

function summarize(
  readings: ValidationReading[],
  viewport: ValidationViewport
): ValidationAccuracy {
  const groups = new Map<string, ScoredValidationPoint[]>()
  const attemptedTargets = new Set<string>()
  const rejections: Record<string, number> = Object.create(null)
  const errors: number[] = []
  for (const reading of readings) {
    const key = JSON.stringify([reading.targetId, reading.target])
    attemptedTargets.add(key)
    let reason = reading.reason
    if (!validViewport(viewport)) {
      reason = "invalid-viewport"
    } else if (!finitePoint(reading.target)) {
      reason = "invalid-target"
    } else if (!finitePoint(reading.point)) {
      reason = reason || "missing-prediction"
    }
    if (reason || !reading.point) {
      const rejection = reason || "missing-prediction"
      rejections[rejection] = (rejections[rejection] ?? 0) + 1
      continue
    }
    const dx = (reading.point[0] - reading.target[0]) * viewport.width
    const dy = (reading.point[1] - reading.target[1]) * viewport.height
    const error = Math.hypot(dx, dy)
    if (!Number.isFinite(error)) {
      rejections["nonfinite-error"] = (rejections["nonfinite-error"] ?? 0) + 1
      continue
    }
    const group = groups.get(key) ?? []
    group.push({
      point: [
        reading.point[0] * viewport.width,
        reading.point[1] * viewport.height,
      ],
      error,
      dx,
      dy,
    })
    groups.set(key, group)
    errors.push(error)
  }
  const result: ValidationAccuracy = {
    meanPixels: null,
    rmsPixels: null,
    p95Pixels: null,
    jitterPixels: null,
    biasPixels: null,
    attemptedCount: readings.length,
    sampleCount: errors.length,
    validFraction: 0,
    targetCount: groups.size,
    attemptedTargetCount: attemptedTargets.size,
    rejections,
  }
  if (readings.length > 0) {
    result.validFraction = errors.length / readings.length
  }
  if (groups.size === 0) {
    return result
  }
  let mean = 0
  let squared = 0
  let jitter = 0
  const bias: ValidationPoint = [0, 0]
  for (const group of groups.values()) {
    const center: ValidationPoint = [0, 0]
    for (const reading of group) {
      center[0] += reading.point[0] / group.length
      center[1] += reading.point[1] / group.length
      mean += reading.error / group.length
      squared += reading.error ** 2 / group.length
      bias[0] += reading.dx / group.length
      bias[1] += reading.dy / group.length
    }
    for (const reading of group) {
      const distance = Math.hypot(
        reading.point[0] - center[0],
        reading.point[1] - center[1]
      )
      jitter += distance ** 2 / group.length
    }
  }
  errors.sort((left, right) => left - right)
  result.meanPixels = mean / groups.size
  result.rmsPixels = Math.sqrt(squared / groups.size)
  result.p95Pixels = errors[Math.ceil(errors.length * 0.95) - 1]!
  result.jitterPixels = Math.sqrt(jitter / groups.size)
  result.biasPixels = [bias[0] / groups.size, bias[1] / groups.size]
  return result
}

/** Score raw observations before filtering; rejected predictions remain in coverage. */
export function evaluateValidation(
  readings: ValidationReading[],
  viewport: ValidationViewport
): ValidationMetrics {
  const unique: ValidationReading[] = []
  let previousTimestamp = -Infinity
  for (const reading of readings) {
    if (
      !Number.isFinite(reading.timestamp) ||
      reading.timestamp <= previousTimestamp
    ) {
      continue
    }
    previousTimestamp = reading.timestamp
    unique.push(reading)
  }
  const targets = new Map<string, ValidationReading[]>()
  const conditions = new Map<string, ValidationReading[]>()
  const displayed: ValidationReading[] = []
  for (const reading of unique) {
    const key = JSON.stringify([reading.targetId, reading.target])
    const target = targets.get(key) ?? []
    target.push(reading)
    targets.set(key, target)
    if (reading.conditionId) {
      const condition = conditions.get(reading.conditionId) ?? []
      condition.push(reading)
      conditions.set(reading.conditionId, condition)
    }
    if (reading.displayedPoint !== undefined) {
      displayed.push({ ...reading, point: reading.displayedPoint })
    }
  }
  let displayedMetrics: ValidationAccuracy | null = null
  if (displayed.length > 0) {
    displayedMetrics = summarize(displayed, viewport)
  }
  return {
    ...summarize(unique, viewport),
    targets: Array.from(targets.values(), (group) => ({
      ...summarize(group, viewport),
      targetId: group[0]!.targetId,
      target: [...group[0]!.target],
    })),
    conditions: Array.from(conditions, ([conditionId, group]) => ({
      ...summarize(group, viewport),
      conditionId,
    })),
    displayed: displayedMetrics,
  }
}
