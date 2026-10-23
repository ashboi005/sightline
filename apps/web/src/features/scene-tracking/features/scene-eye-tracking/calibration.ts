import { pointDistance as distance } from "@/features/scene-tracking/lib/tracking-math"
import type { Point } from "../eye-tracking/eye-tracking.types"
import type {
  CalibrationFitResult,
  EvidenceIssue,
  PairInspectionResult,
  ValidationResidual,
} from "./calibration.types"
import type {
  CalibrationHold,
  CalibrationPair,
  CollectionResult,
  Collector,
  EyeObservation,
  HandObservation,
  ReferenceObservation,
  SceneCalibration,
  ValidationPoint,
  ValidationResult,
} from "./scene.types"
export type { CalibrationFitResult } from "./calibration.types"
export const MAX_FRAME_AGE_MS = 250
export const MAX_PAIR_SKEW_MS = 100
export const MAX_HAND_GAP_MS = 350
// Brief transport/model gaps pause an armed hold. Only fresh paired evidence
// contributes samples; returning evidence must still match the fixation anchor.
export const MAX_HAND_RECOVERY_MS = 3000
export const MIN_EYE_CONFIDENCE = 0.7
export const MAX_EYE_MOVEMENT_RAD = 0.03
const MAX_EYE_SCATTER_RAD = 0.01
// Normalized image error, not an angular accuracy claim.
export const MAX_CALIBRATION_RMS = 0.025
export const MAX_CALIBRATION_POINT_ERROR = 0.05
const REGION_NAMES = [
  "Top left",
  "Top center",
  "Top right",
  "Left",
  "Center",
  "Right",
  "Bottom left",
  "Bottom center",
  "Bottom right",
]
export function sceneRegionLabel(region: number): string {
  return REGION_NAMES[region] ?? "Point"
}
export const CALIBRATION_TARGETS: readonly Point[] = [
  [0.5, 0.5],
  [0.15, 0.15],
  [0.5, 0.15],
  [0.85, 0.15],
  [0.85, 0.5],
  [0.85, 0.85],
  [0.5, 0.85],
  [0.15, 0.85],
  [0.15, 0.5],
]
export const VALIDATION_TARGETS: readonly Point[] = [
  [0.3, 0.3],
  [0.7, 0.3],
  [0.5, 0.42],
  [0.3, 0.7],
  [0.7, 0.7],
]
const finite = (values: number[]) => values.every(Number.isFinite)
export function gazeAngle(a: Point, b: Point): number {
  if (!finite([...a, ...b])) {
    return Infinity
  }
  const normA = Math.hypot(...a, 1)
  const normB = Math.hypot(...b, 1)
  const cosine =
    (a[0] / normA) * (b[0] / normB) +
    (a[1] / normA) * (b[1] / normB) +
    (1 / normA) * (1 / normB)
  return Math.acos(Math.max(-1, Math.min(1, cosine)))
}
export function eyeEvidenceIssue(
  eye?: EyeObservation | null
): EvidenceIssue | null {
  if (
    !eye ||
    !eye.valid ||
    !eye.feature ||
    !finite([...eye.feature, eye.timestamp, eye.confidence]) ||
    eye.confidence < 0 ||
    eye.confidence > 1
  ) {
    return {
      hint: eye?.reason || "Pupil unavailable.",
      canPause:
        eye?.recoverable === true &&
        finite([eye.timestamp, eye.confidence]) &&
        eye.confidence >= 0 &&
        eye.confidence <= 1,
    }
  }
  if (eye.confidence < MIN_EYE_CONFIDENCE) {
    return {
      hint: `Waiting for a clearer pupil (${Math.round(eye.confidence * 100)}%).`,
      canPause: true,
    }
  }
  return null
}
export const sceneRegion = (p: Point) =>
  Math.min(2, Math.floor(p[1] * 3)) * 3 + Math.min(2, Math.floor(p[0] * 3))
export function pairObservation(
  eyes: EyeObservation[],
  hand: HandObservation,
  delayMs: number,
  now: number
): CalibrationPair | null {
  return inspectPairObservation(eyes, hand, delayMs, now).pair
}
export function inspectPairObservation(
  eyes: EyeObservation[],
  hand: HandObservation,
  delayMs: number,
  now: number
): PairInspectionResult {
  const reject = (hint: string) => ({
    pair: null,
    issue: { hint, canPause: false },
  })
  if (hand.landmarks.length !== 1) {
    return reject(
      hand.reason ?? "Waiting for a fresh scene frame and one hand."
    )
  }
  const joints = hand.landmarks[0]
  const tip = joints[8]
  if (
    joints.length !== 21 ||
    !tip ||
    joints.some((joint) => !finite([joint.x, joint.y, joint.z]))
  ) {
    return reject("Keep your fingertip inside the camera view.")
  }
  const result = inspectReferenceObservation(
    eyes,
    {
      scene: hand.scene,
      position: [tip.x, tip.y],
      kind: "hand",
      reason: hand.reason,
    },
    delayMs,
    now
  )
  if (result.pair) {
    result.pair.handedness = hand.handedness[0] ?? "Unknown"
  }
  return result
}
export function inspectReferenceObservation(
  eyes: EyeObservation[],
  reference: ReferenceObservation,
  delayMs: number,
  now: number
): PairInspectionResult {
  const reject = (hint: string, canPause = false) => ({
    pair: null,
    issue: { hint, canPause },
  })
  const { scene, position } = reference
  if (
    !Number.isFinite(delayMs) ||
    Math.abs(delayMs) > 500 ||
    !Number.isFinite(now) ||
    !finite([scene.timestamp, scene.width, scene.height, scene.id]) ||
    now - scene.timestamp < 0 ||
    scene.width <= 0 ||
    scene.height <= 0
  ) {
    return reject(reference.reason ?? "Waiting for a fresh scene reference.")
  }
  if (!position || !finite(position) || position.some((v) => v < 0 || v > 1)) {
    return reject(
      reference.reason ??
        (reference.kind === "hand"
          ? "Keep your fingertip inside the camera view."
          : "Keep the marker inside the camera view.")
    )
  }
  if (now - scene.timestamp > MAX_FRAME_AGE_MS + Math.max(0, -delayMs)) {
    return reject("Paused · waiting for a fresh scene frame.", true)
  }
  // Positive delay means the scene arrives later than the eye stream.
  const targetTime = scene.timestamp - delayMs
  const eye = eyes.reduce<EyeObservation | null>(
    (best, value) =>
      !best ||
      Math.abs(value.timestamp - targetTime) <
        Math.abs(best.timestamp - targetTime)
        ? value
        : best,
    null
  )
  const issue = eyeEvidenceIssue(eye)
  if (issue) {
    return { pair: null, issue }
  }
  if (!eye?.feature) {
    return reject("Pupil unavailable.")
  }
  if (now < eye.timestamp) {
    return reject("Waiting for a fresh eye frame.")
  }
  if (now - eye.timestamp > MAX_FRAME_AGE_MS + Math.abs(delayMs)) {
    return reject("Paused · waiting for a fresh eye frame.", true)
  }
  if (Math.abs(eye.timestamp - targetTime) > MAX_PAIR_SKEW_MS) {
    return reject("Paused · waiting for synchronized camera frames.", true)
  }
  return {
    issue: null,
    pair: {
      eyeId: eye.id,
      sceneId: scene.id,
      eyeTimestamp: eye.timestamp,
      sceneTimestamp: scene.timestamp,
      feature: eye.feature,
      target: [...position],
      handedness: reference.kind,
      width: scene.width,
      height: scene.height,
    },
  }
}
export function createCollector(
  mode: Collector["mode"],
  targets?: readonly Point[]
): Collector {
  return {
    mode,
    targets,
    holds: [],
    pending: [],
    anchor: null,
    candidate: null,
    lastEyeId: -1,
    lastSceneId: -1,
    lastTimestamp: -Infinity,
    armed: false,
    paused: false,
    heldDurationMs: 0,
    recoveryLimitMs: MAX_HAND_GAP_MS,
    targetOverride: null,
    movementSince: null,
  }
}
function collectorTargets(c: Collector) {
  return (
    c.targets ??
    (c.mode === "calibration" ? CALIBRATION_TARGETS : VALIDATION_TARGETS)
  )
}
function clearHold(c: Collector) {
  c.pending = []
  c.anchor = null
  c.paused = false
  c.heldDurationMs = 0
  c.recoveryLimitMs = MAX_HAND_GAP_MS
  c.movementSince = null
}
export function lockCalibrationPoint(c: Collector) {
  c.armed = true
  clearHold(c)
}
export function repeatCollectedPoint(c: Collector, index: number) {
  const hold = c.holds[index]
  if (!hold) {
    return
  }
  const targets = collectorTargets(c)
  c.holds = c.holds.filter((_, i) => i !== index)
  c.targetOverride = targets.find((p) => sceneRegion(p) === hold.region) ?? null
  c.armed = false
  c.candidate = null
  clearHold(c)
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
function aggregate(pairs: CalibrationPair[]): CalibrationHold {
  const feature = [0, 1].map((axis) =>
    median(pairs.map((p) => p.feature[axis]))
  ) as Point
  const target = [0, 1].map((axis) =>
    median(pairs.map((p) => p.target[axis]))
  ) as Point
  return { region: sceneRegion(target), feature, target, pairs: [...pairs] }
}
export function collectPair(
  c: Collector,
  pair: CalibrationPair | null,
  missingTimestamp?: number,
  evidenceHint?: string,
  recoveryLimitMs = MAX_HAND_GAP_MS
): CollectionResult {
  const targets = collectorTargets(c)
  const required = targets.length || 1
  const target = c.targetOverride ?? targets[c.holds.length] ?? null
  const limit = c.armed ? recoveryLimitMs : MAX_HAND_GAP_MS
  const recovering =
    !!c.candidate &&
    missingTimestamp !== undefined &&
    missingTimestamp >= c.lastTimestamp &&
    missingTimestamp - c.lastTimestamp <= limit
  // A brief detection miss must not make the lock button flicker. The last
  // observed location permits confirmation only; it never supplies samples.
  const available = pair ?? (recovering ? c.candidate : null)
  const nearTarget =
    !!available &&
    (c.freeTarget ||
      (!!target &&
        Math.hypot(
          (available.target[0] - target[0]) * available.width,
          (available.target[1] - target[1]) * available.height
        ) <=
          Math.min(available.width, available.height) * 0.1))
  let hint = c.armed ? "Hold steady." : "Place fingertip in the ring."
  let saved = false
  if (!pair) {
    if (recovering) {
      c.paused = true
      c.recoveryLimitMs = limit
      hint = evidenceHint ?? "Reacquiring hand…"
    } else {
      clearHold(c)
      c.candidate = null
      hint = evidenceHint ?? "Waiting for eye and hand."
    }
  } else if (pair.eyeId > c.lastEyeId && pair.sceneId > c.lastSceneId) {
    const gap = pair.sceneTimestamp - c.lastTimestamp
    c.lastTimestamp = pair.sceneTimestamp
    c.lastEyeId = pair.eyeId
    c.lastSceneId = pair.sceneId
    c.candidate = pair
    if (c.automatic && nearTarget && !c.armed && c.holds.length < required) {
      lockCalibrationPoint(c)
    }
    if (!c.armed) {
      clearHold(c)
      hint = nearTarget
        ? "Look at your fingertip. Press Space to lock."
        : "Keep your fingertip in the ring."
    } else {
      if (gap > (c.paused ? c.recoveryLimitMs : recoveryLimitMs)) {
        clearHold(c)
      } else if (gap > MAX_HAND_GAP_MS) {
        // A timer need not run between every network frame. Recover the point
        // consistently even when this frame arrives before the next timer tick.
        c.paused = true
      }
      const fingerMoved =
        !!c.anchor && distance(c.anchor.target, pair.target) > 0.025
      const gazeMoved =
        !!c.anchor &&
        gazeAngle(c.anchor.feature, pair.feature) > MAX_EYE_MOVEMENT_RAD
      if (!nearTarget || fingerMoved || gazeMoved) {
        // Detector jitter contributes neither a sample nor hold time. Keep
        // earlier evidence unless fresh movement persists for 200 ms.
        c.movementSince ??= pair.sceneTimestamp
        c.paused = true
        hint = gazeMoved
          ? "Gaze moved. Hold steady…"
          : "Fingertip moved. Hold steady…"
        if (pair.sceneTimestamp - c.movementSince >= 200) {
          clearHold(c)
          if (nearTarget) {
            c.anchor = pair
            hint = "Settling gaze and fingertip…"
          } else {
            c.paused = true
            hint = "Keep your fingertip in the ring."
          }
        }
      } else {
        c.movementSince = null
        if (!c.anchor) {
          clearHold(c)
          c.anchor = pair
          hint = "Settling gaze and fingertip…"
        }
        if (pair.sceneTimestamp - c.anchor.sceneTimestamp >= 300) {
          if (c.pending.length && !c.paused) {
            c.heldDurationMs += gap
          }
          c.pending.push(pair)
        }
        c.paused = false
        if (c.pending.length >= 20 && c.heldDurationMs >= 800) {
          const hold = aggregate(c.pending)
          const scatter = (axis: "target" | "feature") =>
            Math.sqrt(
              c.pending.reduce(
                (sum, p) =>
                  sum +
                  (axis === "feature"
                    ? gazeAngle(p.feature, hold.feature)
                    : distance(p.target, hold.target)) **
                    2,
                0
              ) / c.pending.length
            )
          const fingerSteady = scatter("target") <= 0.012
          const gazeSteady = scatter("feature") <= MAX_EYE_SCATTER_RAD
          if (fingerSteady && gazeSteady) {
            c.holds.push(hold)
            c.targetOverride = null
            saved = true
            c.armed = false
            hint = "Point saved."
          } else {
            hint = gazeSteady
              ? "Hold your fingertip steady."
              : "Hold your gaze on your fingertip."
          }
          clearHold(c)
        }
      }
    }
  }
  let status: CollectionResult["status"] = "waiting"
  if (saved) {
    status = "saved"
  } else if (c.armed) {
    if (!pair || c.paused || !nearTarget) {
      status = "paused"
    } else {
      status = c.pending.length ? "capturing" : "settling"
    }
  }
  return {
    complete: c.holds.length >= required,
    progress: saved
      ? 1
      : Math.min(1, c.pending.length / 20, c.heldDurationMs / 800),
    hint,
    holds: c.holds,
    armed: c.armed,
    status,
    samples: saved ? c.holds.at(-1)!.pairs.length : c.pending.length,
    canLock:
      !!nearTarget &&
      !c.armed &&
      c.holds.length < required &&
      (c.freeTarget ||
        target === (c.targetOverride ?? targets[c.holds.length])),
    target: c.targetOverride ?? targets[c.holds.length] ?? null,
  }
}
function terms(p: Point, model: SceneCalibration["model"]): number[] {
  const [x, y] = p
  return model === "quadratic" ? [1, x, y, x * x, x * y, y * y] : [1, x, y]
}
function leastSquares(rows: number[][], values: number[][]): number[][] | null {
  const n = rows.length
  const columns = rows[0]?.length ?? 0
  if (!columns || n < columns) {
    return null
  }
  const q: number[][] = []
  const r = Array.from({ length: columns }, () =>
    Array<number>(columns).fill(0)
  )
  for (let j = 0; j < columns; j++) {
    const v = rows.map((row) => row[j])
    // Two-pass modified Gram-Schmidt avoids cancellation in nearly singular fits.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < j; i++) {
        const projection = q[i].reduce((sum, x, k) => sum + x * v[k], 0)
        r[i][j] += projection
        for (let k = 0; k < n; k++) {
          v[k] -= projection * q[i][k]
        }
      }
    }
    r[j][j] = Math.hypot(...v)
    if (r[j][j] < 1e-6 * Math.sqrt(n)) {
      return null
    }
    q.push(v.map((x) => x / r[j][j]))
  }
  const coefficients = values.map((targets) => {
    const a = q.map((col) => col.reduce((sum, x, i) => sum + x * targets[i], 0))
    for (let i = columns - 1; i >= 0; i--) {
      for (let j = i + 1; j < columns; j++) {
        a[i] -= r[i][j] * a[j]
      }
      a[i] /= r[i][i]
    }
    return a
  })
  return coefficients.every(finite) ? coefficients : null
}
function solve(
  holds: CalibrationHold[],
  model: SceneCalibration["model"]
): Pick<
  SceneCalibration,
  "coefficients" | "denominator" | "mean" | "scale" | "model"
> | null {
  const n = holds.length
  const columns = model === "quadratic" ? 6 : 3
  if (n <= columns || holds.some((h) => !finite([...h.feature, ...h.target]))) {
    return null
  }
  const mean = [0, 1].map(
    (axis) => holds.reduce((sum, h) => sum + h.feature[axis], 0) / n
  ) as Point
  const scale = [0, 1].map((axis) =>
    Math.sqrt(
      holds.reduce((sum, h) => sum + (h.feature[axis] - mean[axis]) ** 2, 0) / n
    )
  ) as Point
  if (scale.some((s) => s < 0.002)) {
    return null
  }
  const features = holds.map(
    (h) =>
      [
        (h.feature[0] - mean[0]) / scale[0],
        (h.feature[1] - mean[1]) / scale[1],
      ] as Point
  )
  if (model === "projective") {
    const rows = features.flatMap(([x, y], i) => {
      const [u, v] = holds[i].target
      return [
        [1, x, y, 0, 0, 0, -u * x, -u * y],
        [0, 0, 0, 1, x, y, -v * x, -v * y],
      ]
    })
    const solution = leastSquares(rows, [holds.flatMap((h) => h.target)])?.[0]
    if (!solution) {
      return null
    }
    const denominator: Point = [solution[6], solution[7]]
    const xs = features.map((p) => p[0])
    const ys = features.map((p) => p[1])
    // Do not admit a projective horizon inside the sampled feature rectangle.
    for (const x of [Math.min(...xs), Math.max(...xs)]) {
      for (const y of [Math.min(...ys), Math.max(...ys)]) {
        if (1 + denominator[0] * x + denominator[1] * y < 0.05) {
          return null
        }
      }
    }
    return {
      model,
      mean,
      scale,
      denominator,
      coefficients: [solution.slice(0, 3), solution.slice(3, 6)],
    }
  }
  const coefficients = leastSquares(
    features.map((p) => terms(p, model)),
    [0, 1].map((axis) => holds.map((h) => h.target[axis]))
  ) as [number[], number[]] | null
  if (!coefficients) {
    return null
  }
  return { model, mean, scale, coefficients }
}
export function mapSceneGaze(
  calibration: Pick<
    SceneCalibration,
    "coefficients" | "denominator" | "mean" | "scale" | "model"
  >,
  feature: Point
): Point | null {
  if (!finite(feature)) {
    return null
  }
  const normalized: Point = [
    (feature[0] - calibration.mean[0]) / calibration.scale[0],
    (feature[1] - calibration.mean[1]) / calibration.scale[1],
  ]
  const row = terms(normalized, calibration.model)
  let divisor = 1
  if (calibration.model === "projective") {
    if (!calibration.denominator || !finite(calibration.denominator)) {
      return null
    }
    divisor +=
      calibration.denominator[0] * normalized[0] +
      calibration.denominator[1] * normalized[1]
    if (!Number.isFinite(divisor) || divisor < 1e-6) {
      return null
    }
  }
  const p = calibration.coefficients.map(
    (c) => c.reduce((sum, v, i) => sum + v * row[i], 0) / divisor
  ) as Point
  return finite(p) ? p : null
}
function summarizeErrors(errors: number[]) {
  return {
    rms: Math.sqrt(
      errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length
    ),
    maximum: Math.max(...errors),
    errors,
  }
}
function trainingError(
  holds: CalibrationHold[],
  fit: NonNullable<ReturnType<typeof solve>>
) {
  return summarizeErrors(
    holds.map((hold) => {
      const position = mapSceneGaze(fit, hold.feature)
      return position ? distance(position, hold.target) : Infinity
    })
  )
}
function crossValidate(
  holds: CalibrationHold[],
  model: SceneCalibration["model"]
) {
  return summarizeErrors(
    holds.map((hold, index) => {
      const fit = solve(
        holds.filter((_, i) => i !== index),
        model
      )
      const position = fit && mapSceneGaze(fit, hold.feature)
      return position ? distance(position, hold.target) : Infinity
    })
  )
}
export function fitSceneCalibration(
  holds: CalibrationHold[]
): SceneCalibration | null {
  return inspectSceneCalibration(holds).calibration
}
export function inspectSceneCalibration(
  holds: CalibrationHold[]
): CalibrationFitResult {
  const failure = (reason: string): CalibrationFitResult => ({
    calibration: null,
    reason,
    retryIndex: null,
    rms: null,
    maximum: null,
    pointErrors: [],
  })
  if (holds.some((h) => !finite([...h.target, ...h.feature]))) {
    return failure("Invalid camera or gaze coordinates. Reconnect the cameras.")
  }
  if (
    holds.length !== 9 ||
    new Set(holds.map((h) => h.region)).size !== 9 ||
    holds.some((h) => h.region !== sceneRegion(h.target))
  ) {
    return failure(
      "Scene coverage is incomplete. Follow all nine ring positions."
    )
  }
  const min = [0, 1].map((axis) =>
    Math.min(...holds.map((h) => h.target[axis]))
  ) as Point
  const max = [0, 1].map((axis) =>
    Math.max(...holds.map((h) => h.target[axis]))
  ) as Point
  if (max[0] - min[0] < 0.5 || max[1] - min[1] < 0.5) {
    return failure(
      "Scene coverage is too small. Spread the points across the view."
    )
  }
  const candidates = (["affine", "projective", "quadratic"] as const).flatMap(
    (model) => {
      const fit = solve(holds, model)
      return fit
        ? [
            {
              fit,
              error: crossValidate(holds, model),
              training: trainingError(holds, fit),
            },
          ]
        : []
    }
  )
  const usable = candidates.filter((c) => Number.isFinite(c.training.rms))
  const acceptable = usable.filter(
    (c) =>
      c.training.rms <= MAX_CALIBRATION_RMS &&
      c.training.maximum <= MAX_CALIBRATION_POINT_ERROR
  )
  // Keep the held-out model comparison when no precise fit exists. Filtering
  // for a looser training fit here could select an overfitted quadratic.
  const pool = acceptable.length ? acceptable : usable
  let selected = pool[0]
  for (const candidate of pool.slice(1)) {
    if (
      selected.error.rms > 1e-6 &&
      candidate.error.rms < selected.error.rms * 0.9
    ) {
      selected = candidate
    }
  }
  if (!selected) {
    return failure(
      "Eye gaze did not span two directions. Rebuild the eye model."
    )
  }
  const { fit, error, training } = selected
  const candidate: SceneCalibration = {
    ...fit,
    trainingRms: training.rms,
    maxTrainingError: training.maximum,
    crossValidationRms: error.rms,
    maxValidationError: error.maximum,
    bounds: { min, max },
    holds: [...holds],
  }
  // Leaving a corner out tests extrapolation beyond the remaining sample hull.
  // Use it to compare models. A bounded fit can proceed to the five fresh
  // physical checks even when collection noise exceeds the final RMS limit.
  // Only those independent checks can mark the mapping accurate. Repeating
  // the worst point does not necessarily resolve noise across several holds.
  if (training.maximum <= MAX_CALIBRATION_POINT_ERROR) {
    return {
      calibration: candidate,
      reason: "",
      retryIndex: null,
      rms: error.rms,
      maximum: error.maximum,
      pointErrors: error.errors,
    }
  }
  const retryIndex = training.errors.indexOf(training.maximum)
  const retryLabel = sceneRegionLabel(holds[retryIndex].region).toLowerCase()
  return {
    calibration: null,
    previewCalibration: candidate,
    reason: `Refine ${retryLabel}. The other eight points are saved.`,
    retryIndex,
    rms: training.rms,
    maximum: training.maximum,
    pointErrors: training.errors,
  }
}
export function validateSceneCalibration(
  calibration: SceneCalibration,
  holds: CalibrationHold[],
  offset: Point = [0, 0]
): ValidationResult | null {
  if (holds.length < 5 || !finite(offset)) {
    return null
  }
  let normalized = 0
  let pixels = 0
  let maxNormalizedError = 0
  let maxPixelError = 0
  const points: ValidationPoint[] = []
  const residuals: ValidationResidual[] = []
  for (const [index, h] of holds.entries()) {
    if (!h.pairs.length) {
      return null
    }
    let holdNormalized = 0
    let holdPixels = 0
    const delta: Point = [0, 0]
    const pixelDelta: Point = [0, 0]
    const target: Point = [0, 0]
    for (const pair of h.pairs) {
      const mapped = mapSceneGaze(calibration, pair.feature)
      if (
        !mapped ||
        !finite(mapped) ||
        !finite(pair.target) ||
        !finite([pair.width, pair.height]) ||
        pair.width <= 0 ||
        pair.height <= 0
      ) {
        return null
      }
      const rawDelta: Point = [
        mapped[0] + offset[0] - pair.target[0],
        mapped[1] + offset[1] - pair.target[1],
      ]
      const error = Math.hypot(...rawDelta)
      const pixelError = Math.hypot(
        rawDelta[0] * pair.width,
        rawDelta[1] * pair.height
      )
      const weight = 1 / h.pairs.length
      holdNormalized += error ** 2 * weight
      holdPixels += pixelError ** 2 * weight
      maxNormalizedError = Math.max(maxNormalizedError, error)
      maxPixelError = Math.max(maxPixelError, pixelError)
      delta[0] += rawDelta[0] * weight
      delta[1] += rawDelta[1] * weight
      pixelDelta[0] += rawDelta[0] * pair.width * weight
      pixelDelta[1] += rawDelta[1] * pair.height * weight
      target[0] += pair.target[0] * weight
      target[1] += pair.target[1] * weight
      residuals.push({ delta: rawDelta, weight: weight / holds.length })
    }
    normalized += holdNormalized
    pixels += holdPixels
    points.push({
      index,
      target,
      position: [target[0] + delta[0], target[1] + delta[1]],
      delta,
      pixelDelta,
      normalizedError: Math.sqrt(holdNormalized),
      pixelError: Math.sqrt(holdPixels),
    })
  }
  const normalizedRms = Math.sqrt(normalized / holds.length)
  const passed =
    normalizedRms <= MAX_CALIBRATION_RMS &&
    maxNormalizedError <= MAX_CALIBRATION_POINT_ERROR
  let suggestedOffset: Point | null = null
  let retryIndex: number | null = null
  if (!passed) {
    const bias: Point = [0, 0]
    for (const point of points) {
      bias[0] += point.delta[0] / points.length
      bias[1] += point.delta[1] / points.length
    }
    const centeredErrors = residuals.map((point) => distance(point.delta, bias))
    const centeredRms = Math.sqrt(
      centeredErrors.reduce(
        (sum, e, index) => sum + e ** 2 * residuals[index].weight,
        0
      )
    )
    const candidate: Point = [offset[0] - bias[0], offset[1] - bias[1]]
    // This is a proposed correction, not an accuracy pass. It must be checked
    // against new physical fixations before it can supply valid gaze data.
    if (
      centeredRms <= MAX_CALIBRATION_RMS &&
      centeredRms <= normalizedRms * 0.5 &&
      Math.max(...centeredErrors) <= MAX_CALIBRATION_POINT_ERROR &&
      candidate.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)
    ) {
      suggestedOffset = candidate
    } else {
      const worst = points.reduce((a, b) =>
        a.normalizedError > b.normalizedError ? a : b
      )
      const remaining = points.filter((point) => point !== worst)
      const remainingRms = Math.sqrt(
        remaining.reduce((sum, point) => sum + point.normalizedError ** 2, 0) /
          remaining.length
      )
      if (
        remainingRms <= MAX_CALIBRATION_RMS &&
        remaining.every(
          (point) => point.normalizedError <= MAX_CALIBRATION_POINT_ERROR
        )
      ) {
        retryIndex = worst.index
      }
    }
  }
  return {
    normalizedRms,
    pixelRms: Math.sqrt(pixels / holds.length),
    maxNormalizedError,
    maxPixelError,
    passed,
    holds: holds.length,
    pairs: holds.reduce((sum, h) => sum + h.pairs.length, 0),
    offset: [...offset],
    points,
    suggestedOffset,
    retryIndex,
  }
}
