import {
  DEFAULT_CAMERA_TRANSFORM,
  normalizeCameraTransform,
} from "../eye-tracking/camera-transform"
import type { Point } from "../eye-tracking/eye-tracking.types"
import {
  CALIBRATION_TARGETS,
  collectPair,
  createCollector,
  eyeEvidenceIssue,
  gazeAngle,
  inspectReferenceObservation,
  inspectSceneCalibration,
  lockCalibrationPoint,
  mapSceneGaze,
  MAX_EYE_MOVEMENT_RAD,
  MAX_FRAME_AGE_MS,
  MAX_HAND_GAP_MS,
  MAX_HAND_RECOVERY_MS,
  MAX_PAIR_SKEW_MS,
  MIN_EYE_CONFIDENCE,
  repeatCollectedPoint,
  sceneRegion,
  validateSceneCalibration,
} from "./calibration"
import type { SceneProfileCalibration } from "./calibration-profiles.types"
import { fitOnePointCalibration } from "./one-point-calibration"
import type { SceneSessionSnapshot } from "./scene-session.types"
import type {
  CalibrationMethod,
  CameraOrientation,
  Collector,
  EyeObservation,
  GazeMeasurement,
  HandObservation,
  ReferenceObservation,
  SceneCalibration,
  SceneObservation,
} from "./scene.types"
export type { SceneSessionSnapshot } from "./scene-session.types"
export function hasCurrentAccuracyCheck(state: SceneSessionSnapshot) {
  return (
    !!state.validation?.passed &&
    state.offset.every(
      (value, index) => value === (state.validation?.offset?.[index] ?? 0)
    )
  )
}
export function canUseSceneCalibration(state: SceneSessionSnapshot) {
  return (
    !!state.calibration &&
    (hasCurrentAccuracyCheck(state) ||
      state.method === "one-point" ||
      !!state.reusedCalibration)
  )
}
export class SceneSession {
  private snapshot: SceneSessionSnapshot = {
    method: "hand",
    calibration: null,
    validation: null,
    capture: null,
    collection: null,
    notice: "",
    delayMs: 0,
    offset: [0, 0],
    measurement: null,
    trace: [],
    fitFailure: null,
  }
  private eyes: EyeObservation[] = []
  private collector: Collector | null = null
  private listeners = new Set<() => void>()
  private lastHandId = -1
  private lastMeasuredEyeId = -1
  private continuityAfter = -Infinity
  private lastGoodEyeTimestamp = -Infinity
  private pendingHands: ReferenceObservation[] = []
  private scenes: SceneObservation[] = []
  private captureBaseline: SceneSessionSnapshot | null = null
  private previousMapping: SceneCalibration | null = null
  private eyeMovementSince: number | null = null
  private orientation: CameraOrientation = {
    eye: DEFAULT_CAMERA_TRANSFORM,
    scene: DEFAULT_CAMERA_TRANSFORM,
  }
  constructor(method: CalibrationMethod = "hand") {
    this.snapshot.method = method
  }
  getSnapshot = () => this.snapshot
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private update(next: Partial<SceneSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next }
    this.listeners.forEach((fn) => fn())
  }
  addEye(eye: EyeObservation, now = eye.timestamp) {
    if (this.eyes.at(-1)?.id === eye.id) {
      return
    }
    this.eyes.push(eye)
    this.eyes = this.eyes
      .filter((value) => eye.timestamp - value.timestamp <= 3000)
      .slice(-180)
    const issue = eyeEvidenceIssue(eye)
    if (!issue) {
      this.lastGoodEyeTimestamp = eye.timestamp
    }
    const anchor = this.collector?.anchor
    const moved =
      !!anchor &&
      !issue &&
      !!eye.feature &&
      gazeAngle(eye.feature, anchor.feature) > MAX_EYE_MOVEMENT_RAD
    if (!moved) {
      this.eyeMovementSince = null
    }
    if (
      this.collector &&
      issue?.canPause &&
      eye.timestamp - this.lastGoodEyeTimestamp <=
        (eye.recoverable ? MAX_HAND_RECOVERY_MS : MAX_HAND_GAP_MS)
    ) {
      this.update({
        collection: collectPair(
          this.collector,
          null,
          eye.timestamp + this.snapshot.delayMs,
          issue.hint,
          MAX_HAND_RECOVERY_MS
        ),
      })
    } else if (this.collector && issue) {
      this.continuityAfter = eye.timestamp
      this.pendingHands = []
      this.update({
        collection: collectPair(this.collector, null, undefined, issue.hint),
      })
    } else if (this.collector && moved) {
      this.eyeMovementSince ??= eye.timestamp
      const sustained = eye.timestamp - this.eyeMovementSince >= 200
      if (sustained) {
        this.continuityAfter = eye.timestamp
        this.pendingHands = []
      }
      this.update({
        collection: collectPair(
          this.collector,
          null,
          sustained ? undefined : eye.timestamp + this.snapshot.delayMs,
          "Gaze moved. Hold steady…",
          MAX_HAND_RECOVERY_MS
        ),
      })
    }
    this.drainHands(now)
  }
  invalidate(
    reason = "Camera or eye setup changed. Load a saved profile or calibrate."
  ) {
    const hadMapping = !!this.snapshot.calibration || !!this.snapshot.capture
    this.collector = null
    this.eyes = []
    this.lastHandId = -1
    this.lastMeasuredEyeId = -1
    this.continuityAfter = -Infinity
    this.lastGoodEyeTimestamp = -Infinity
    this.pendingHands = []
    this.scenes = []
    this.previousMapping = null
    this.captureBaseline = null
    this.eyeMovementSince = null
    this.update({
      calibration: null,
      validation: null,
      capture: null,
      collection: null,
      measurement: null,
      trace: [],
      notice: hadMapping ? reason : "",
      fitFailure: null,
      failedCandidate: null,
      offset: [0, 0],
      reusedCalibration: false,
    })
  }
  restoreCalibration(profile: SceneProfileCalibration) {
    if (this.snapshot.capture) {
      return
    }
    this.invalidate("")
    this.update({
      calibration: structuredClone(profile.calibration),
      method: profile.method,
      offset: [...profile.offset],
      delayMs: profile.delayMs,
      // Older profiles could only be saved after passing the reuse gate.
      // An unchecked saved mapping must remain a preview after reload.
      reusedCalibration: profile.unverified !== true,
      notice: "",
    })
  }
  setMethod(method: CalibrationMethod) {
    if (
      !["hand", "marker", "one-point"].includes(method) ||
      method === this.snapshot.method
    ) {
      return
    }
    const previous =
      method === "one-point" && this.snapshot.validation?.passed
        ? this.snapshot.calibration
        : null
    this.invalidate("Calibration method changed.")
    this.previousMapping = previous
    this.update({ method })
  }
  setCameraOrientation(orientation: CameraOrientation) {
    const next = {
      eye: normalizeCameraTransform(orientation.eye),
      scene: normalizeCameraTransform(orientation.scene),
    }
    if (JSON.stringify(next) === JSON.stringify(this.orientation)) {
      return
    }
    this.orientation = next
    this.invalidate()
  }
  setOnePointGain(gain: Point) {
    const calibration = this.snapshot.calibration
    if (
      !calibration?.onePoint ||
      calibration.onePoint.basis !== "projection" ||
      this.snapshot.capture
    ) {
      return
    }
    const fitted = fitOnePointCalibration(
      calibration.holds[0],
      null,
      gain,
      calibration.onePoint.orientation ?? this.orientation
    )
    if (!fitted) {
      return
    }
    this.update({
      calibration: fitted.calibration,
      validation: null,
      measurement: null,
      trace: [],
      notice: "",
    })
  }
  setDelay(delayMs: number) {
    if (
      !Number.isFinite(delayMs) ||
      Math.abs(delayMs) > 500 ||
      delayMs === this.snapshot.delayMs
    ) {
      return
    }
    this.invalidate("Camera delay changed. Calibrate again.")
    this.update({ delayMs })
  }
  setOffset(offset: Point) {
    if (
      !this.snapshot.calibration ||
      this.snapshot.capture ||
      offset.some((v) => !Number.isFinite(v) || Math.abs(v) > 1) ||
      offset.every((v, i) => v === this.snapshot.offset[i])
    ) {
      return
    }
    this.update({
      offset: [...offset],
      reusedCalibration:
        !!this.snapshot.reusedCalibration || !!this.snapshot.validation?.passed,
      measurement: null,
      trace: [],
      notice: "",
    })
  }
  retryValidationPoint() {
    const index = this.snapshot.validation?.retryIndex
    const holds = this.snapshot.collection?.holds
    if (
      this.snapshot.capture ||
      !this.snapshot.calibration ||
      index == null ||
      !holds?.[index] ||
      this.snapshot.offset.some(
        (value, i) => value !== (this.snapshot.validation?.offset?.[i] ?? 0)
      )
    ) {
      return
    }
    this.collector = createCollector("validation")
    this.configureCollector("validation")
    this.collector.holds = [...holds]
    repeatCollectedPoint(this.collector, index)
    this.lastHandId = -1
    this.pendingHands = []
    this.continuityAfter = this.eyes.at(-1)?.timestamp ?? -Infinity
    this.update({
      capture: "validation",
      validation: null,
      collection: collectPair(this.collector, null),
      notice: `Repeat point ${index + 1}. Four checks kept.`,
    })
  }
  previewFailedCandidate() {
    const candidate = this.snapshot.failedCandidate
    if (this.snapshot.capture || !candidate) {
      return
    }
    this.lastMeasuredEyeId = -1
    this.update({
      ...candidate,
      reusedCalibration: false,
      measurement: null,
      trace: [],
      failedCandidate: null,
      notice: "Replacement preview · accuracy not verified.",
    })
  }
  private restoredMapping(
    baseline: SceneSessionSnapshot
  ): Partial<SceneSessionSnapshot> {
    this.lastMeasuredEyeId = -1
    return {
      calibration: baseline.calibration,
      validation: baseline.validation,
      offset: baseline.offset,
      reusedCalibration: baseline.reusedCalibration,
      measurement: null,
      trace: [],
    }
  }
  previewCalibrationCandidate() {
    const candidate = this.snapshot.fitFailure?.previewCalibration
    if (this.snapshot.capture || !candidate) {
      return
    }
    this.captureBaseline = null
    this.update({
      calibration: { ...candidate, method: this.snapshot.method },
      validation: null,
      offset: [0, 0],
      reusedCalibration: false,
      measurement: null,
      trace: [],
      notice: "Mapping preview · accuracy not measured.",
    })
  }
  retryCalibrationPoint() {
    const failure = this.snapshot.fitFailure
    if (this.snapshot.capture || !failure || failure.retryIndex == null) {
      return
    }
    if (!this.captureBaseline && this.snapshot.calibration) {
      this.captureBaseline = this.snapshot
    }
    this.collector = createCollector("calibration")
    this.configureCollector("calibration")
    this.collector.holds = [...failure.holds]
    repeatCollectedPoint(this.collector, failure.retryIndex)
    this.lastHandId = -1
    this.pendingHands = []
    this.continuityAfter = this.eyes.at(-1)?.timestamp ?? -Infinity
    this.update({
      capture: "calibration",
      collection: collectPair(this.collector, null),
      notice: failure.reason,
    })
  }
  startCapture(mode: Collector["mode"]) {
    if (mode === "validation" && !this.snapshot.calibration) {
      return
    }
    if (
      mode === "calibration" &&
      this.snapshot.method === "one-point" &&
      this.snapshot.validation?.passed
    ) {
      this.previousMapping = this.snapshot.calibration
    }
    if (!this.captureBaseline && this.snapshot.calibration) {
      this.captureBaseline = this.snapshot
    }
    this.collector = createCollector(mode)
    this.configureCollector(mode)
    this.lastHandId = -1
    this.pendingHands = []
    this.continuityAfter = -Infinity
    this.update({
      capture: mode,
      collection: collectPair(this.collector, null),
      notice: "",
      fitFailure: null,
    })
  }
  private configureCollector(mode: Collector["mode"]) {
    if (!this.collector) {
      return
    }
    this.collector.automatic = this.snapshot.method === "marker"
    if (mode === "calibration" && this.snapshot.method === "one-point") {
      this.collector.targets = [[0.5, 0.5]]
      this.collector.freeTarget = true
    }
  }
  lockPoint() {
    if (
      !this.collector ||
      (!this.snapshot.collection?.canLock && !this.collector.freeTarget)
    ) {
      return
    }
    // Start with evidence received after the user's confirmation, including
    // when a network stream has queued delayed frames.
    this.pendingHands = []
    this.continuityAfter = this.eyes.at(-1)?.timestamp ?? -Infinity
    lockCalibrationPoint(this.collector)
    this.update({
      collection: {
        ...(this.snapshot.collection ?? collectPair(this.collector, null)),
        armed: true,
        canLock: false,
        progress: 0,
        status: "settling",
        samples: 0,
        hint: "Hold steady.",
      },
    })
  }
  cancelCapture() {
    const baseline = this.captureBaseline
    this.captureBaseline = null
    this.collector = null
    this.pendingHands = []
    this.update({
      capture: null,
      collection: null,
      ...(baseline ? this.restoredMapping(baseline) : {}),
      notice: this.snapshot.fitFailure?.reason ?? "Collection cancelled.",
    })
  }
  observeHand(hand: HandObservation, now: number) {
    if (this.snapshot.method === "marker") {
      return
    }
    const joints = hand.landmarks.length === 1 ? hand.landmarks[0] : null
    const tip = joints?.[8]
    const usable =
      joints?.length === 21 &&
      tip &&
      joints.every((p) => [p.x, p.y, p.z].every(Number.isFinite))
    this.observeReference(
      {
        scene: hand.scene,
        position: usable ? [tip.x, tip.y] : null,
        kind: "hand",
        reason:
          hand.reason ??
          (hand.landmarks.length > 1
            ? "Show only one hand."
            : "Paused · reacquiring hand."),
      },
      now
    )
  }
  observeReference(reference: ReferenceObservation, now: number) {
    if (
      !this.collector ||
      this.lastHandId === reference.scene.id ||
      reference.kind !== (this.snapshot.method === "marker" ? "marker" : "hand")
    ) {
      return
    }
    this.lastHandId = reference.scene.id
    if (!reference.position) {
      this.pendingHands = []
      this.update({
        collection: collectPair(
          this.collector,
          null,
          reference.scene.timestamp,
          reference.reason ?? "Paused · reacquiring target.",
          MAX_HAND_RECOVERY_MS
        ),
      })
      return
    }
    this.pendingHands.push(reference)
    this.pendingHands = this.pendingHands.slice(-90)
    this.drainHands(now)
  }
  private drainHands(now: number) {
    while (this.collector && this.pendingHands.length) {
      const hand = this.pendingHands[0]
      const targetTime = hand.scene.timestamp - this.snapshot.delayMs
      const maxAge = MAX_FRAME_AGE_MS + Math.max(0, -this.snapshot.delayMs)
      if (
        now - hand.scene.timestamp <= maxAge &&
        (this.eyes.at(-1)?.timestamp ?? -Infinity) < targetTime
      ) {
        // Independent camera streams and workers finish in either order. Wait
        // within the existing freshness deadline for the corresponding eye.
        return
      }
      this.pendingHands.shift()
      this.collectHand(hand, now)
    }
    if (!this.collector) {
      this.pendingHands = []
    }
  }
  private collectHand(hand: ReferenceObservation, now: number) {
    if (!this.collector) {
      return
    }
    const result = inspectReferenceObservation(
      this.eyes,
      hand,
      this.snapshot.delayMs,
      now
    )
    let pair = result.pair
    if (pair && pair.eyeTimestamp <= this.continuityAfter) {
      pair = null
    }
    if (
      pair &&
      this.snapshot.method === "marker" &&
      this.snapshot.capture === "calibration" &&
      !this.collector.armed
    ) {
      const covered = new Set(this.collector.holds.map((hold) => hold.region))
      const region = sceneRegion(pair.target)
      this.collector.targetOverride = covered.has(region)
        ? (CALIBRATION_TARGETS.find(
            (target) => !covered.has(sceneRegion(target))
          ) ?? null)
        : (CALIBRATION_TARGETS.find(
            (target) => sceneRegion(target) === region
          ) ?? null)
    }
    const collection = collectPair(
      this.collector,
      pair,
      result.issue?.canPause &&
        hand.scene.timestamp -
          this.snapshot.delayMs -
          this.lastGoodEyeTimestamp <=
          MAX_HAND_RECOVERY_MS
        ? hand.scene.timestamp
        : undefined,
      result.issue?.hint,
      MAX_HAND_RECOVERY_MS
    )
    if (!collection.complete) {
      this.update({ collection })
      return
    }
    // Publish the last saved hold before fitting can start validation or a retry.
    this.update({ collection })
    if (this.snapshot.capture === "validation" && this.snapshot.calibration) {
      const validation = validateSceneCalibration(
        this.snapshot.calibration,
        collection.holds,
        this.snapshot.offset
      )
      let notice = "Accuracy could not be measured. Check again."
      if (validation) {
        notice = `${validation.pixelRms.toFixed(1)} px RMS · worst ${validation.maxPixelError.toFixed(1)} px. Not verified.`
        if (validation.passed) {
          notice = `Accuracy checked · ${validation.pixelRms.toFixed(1)} px RMS.`
        }
      }
      const baseline = this.captureBaseline
      const restoreAccepted =
        !validation?.passed &&
        baseline &&
        baseline.calibration !== this.snapshot.calibration &&
        canUseSceneCalibration(baseline)
      if (restoreAccepted) {
        const failedCandidate = {
          calibration: this.snapshot.calibration,
          validation,
          offset: this.snapshot.offset,
          collection,
        }
        this.update({
          ...this.restoredMapping(baseline),
          failedCandidate,
          capture: null,
          collection: null,
          notice:
            "Replacement accuracy check failed. Previous mapping restored.",
        })
      } else {
        this.update({
          validation,
          reusedCalibration: false,
          capture: null,
          collection,
          notice,
        })
      }
      this.captureBaseline = null
    } else {
      if (this.snapshot.method === "one-point") {
        const fitted = fitOnePointCalibration(
          collection.holds[0],
          this.previousMapping,
          undefined,
          this.orientation
        )
        this.update({
          calibration: fitted?.calibration ?? this.snapshot.calibration,
          offset: fitted?.offset ?? this.snapshot.offset,
          validation: fitted ? null : this.snapshot.validation,
          capture: null,
          collection,
          notice: fitted
            ? "One-point estimate · accuracy not measured."
            : "Unable to estimate this point.",
        })
        this.collector = null
        this.captureBaseline = null
        return
      }
      const result = inspectSceneCalibration(collection.holds)
      const { calibration } = result
      this.update({
        calibration: calibration
          ? { ...calibration, method: this.snapshot.method }
          : this.snapshot.calibration,
        validation: calibration ? null : this.snapshot.validation,
        offset: calibration ? [0, 0] : this.snapshot.offset,
        capture: null,
        collection,
        notice: calibration
          ? "Mapping fitted. Check five fresh points."
          : result.reason,
        fitFailure: calibration
          ? null
          : { ...result, holds: [...collection.holds] },
      })
      if (calibration) {
        this.startCapture("validation")
        this.update({ notice: "Check five fresh points." })
        return
      }
    }
    this.collector = null
    this.captureBaseline = null
  }
  measure(latestScene: SceneObservation | null, now: number) {
    if (latestScene && this.scenes.at(-1)?.id !== latestScene.id) {
      this.scenes.push(latestScene)
      this.scenes = this.scenes
        .filter((s) => now - s.timestamp <= 3000)
        .slice(-180)
    }
    const calibration = this.snapshot.calibration
    if (!calibration) {
      return
    }
    const newestEye = this.eyes.at(-1)
    let scene = latestScene
    // Independent network streams arrive out of phase. Pair against the newest
    // decoded eye evidence instead of briefly invalidating it on every Scene arrival.
    if (newestEye) {
      const sceneTime = newestEye.timestamp + this.snapshot.delayMs
      scene = this.scenes.reduce<SceneObservation | null>(
        (best, value) =>
          !best ||
          Math.abs(value.timestamp - sceneTime) <
            Math.abs(best.timestamp - sceneTime)
            ? value
            : best,
        null
      )
    }
    const time = (scene?.timestamp ?? now) - this.snapshot.delayMs
    const eye = this.eyes.reduce<EyeObservation | null>(
      (best, e) =>
        !best || Math.abs(e.timestamp - time) < Math.abs(best.timestamp - time)
          ? e
          : best,
      null
    )
    let reason = ""
    let position: Point | null = null
    if (
      !latestScene ||
      now - latestScene.timestamp > MAX_FRAME_AGE_MS ||
      !scene ||
      !Number.isFinite(scene.timestamp) ||
      !Number.isFinite(scene.width) ||
      !Number.isFinite(scene.height) ||
      scene.width <= 0 ||
      scene.height <= 0 ||
      now < scene.timestamp ||
      now - scene.timestamp >
        MAX_FRAME_AGE_MS + Math.max(0, -this.snapshot.delayMs)
    ) {
      reason = "Scene frames stale or unavailable"
    } else if (
      !newestEye?.valid ||
      !eye ||
      !eye.valid ||
      !eye.feature ||
      !Number.isFinite(eye.confidence) ||
      !Number.isFinite(eye.timestamp) ||
      now < eye.timestamp ||
      eye.confidence < MIN_EYE_CONFIDENCE ||
      now - eye.timestamp > MAX_FRAME_AGE_MS + Math.abs(this.snapshot.delayMs)
    ) {
      reason = "Fresh pupil evidence unavailable"
    } else if (Math.abs(eye.timestamp - time) > MAX_PAIR_SKEW_MS) {
      reason = "Camera frames could not be paired"
    } else {
      position = mapSceneGaze(calibration, eye.feature)
    }
    const mapped = position
    if (position) {
      position = [
        position[0] + this.snapshot.offset[0],
        position[1] + this.snapshot.offset[1],
      ]
    }
    if (!position && !reason) {
      reason = "Invalid gaze feature"
    }
    // Repainting/new scene frames must not refresh already-used pupil evidence.
    if (position && eye?.id === this.lastMeasuredEyeId) {
      return
    }
    if (position && eye) {
      this.lastMeasuredEyeId = eye.id
    }
    const inFrame = !!position && position.every((v) => v >= 0 && v <= 1)
    if (position && !inFrame) {
      reason = "Gaze outside the scene camera view"
    }
    const verified = hasCurrentAccuracyCheck(this.snapshot)
    const estimated =
      !verified &&
      (this.snapshot.method === "one-point" ||
        !!this.snapshot.reusedCalibration)
    const preview = inFrame && !verified && !estimated && !this.snapshot.capture
    if (inFrame && !verified) {
      reason = "Accuracy check required"
      if (this.snapshot.reusedCalibration) {
        reason = "Reused calibration · accuracy not rechecked"
      } else if (estimated) {
        reason = "One-point estimate · accuracy not measured"
      }
    }
    const extrapolated =
      !!mapped &&
      mapped.some(
        (v, i) => v < calibration.bounds.min[i] || v > calibration.bounds.max[i]
      )
    const measurement: GazeMeasurement = {
      timestamp: now,
      eyeId: eye?.id ?? null,
      sceneId: scene?.id ?? null,
      eyeTimestamp: eye?.timestamp ?? null,
      sceneTimestamp: scene?.timestamp ?? null,
      confidence: eye?.confidence ?? 0,
      position,
      pixels:
        position && scene
          ? [position[0] * scene.width, position[1] * scene.height]
          : null,
      valid: inFrame && (verified || estimated) && !this.snapshot.capture,
      estimated,
      preview,
      reason,
      extrapolated,
    }
    const trace = [...this.snapshot.trace, measurement]
      .filter((m) => now - m.timestamp <= 3000)
      .slice(-120)
    this.update({ measurement, trace })
  }
  checkCaptureFreshness(now: number) {
    if (this.collector && now - this.lastGoodEyeTimestamp > MAX_HAND_GAP_MS) {
      const issue = eyeEvidenceIssue(this.eyes.at(-1))
      const recovering =
        (!issue || (this.eyes.at(-1)?.recoverable && issue.canPause)) &&
        now - this.lastGoodEyeTimestamp <= MAX_HAND_RECOVERY_MS
      if (!recovering) {
        this.continuityAfter = Math.max(this.continuityAfter, now)
        this.pendingHands = []
      }
      this.update({
        collection: collectPair(
          this.collector,
          null,
          recovering ? now : undefined,
          recovering
            ? (issue?.hint ?? "Paused · eye stream delayed. Good samples kept.")
            : (issue?.hint ??
                "Eye stream interrupted. Hold steady to restart this point."),
          MAX_HAND_RECOVERY_MS
        ),
      })
      return
    }
    if (
      this.collector &&
      this.collector.lastTimestamp <
        now - (MAX_HAND_GAP_MS + Math.max(0, -this.snapshot.delayMs))
    ) {
      this.update({
        collection: collectPair(
          this.collector,
          null,
          now,
          eyeEvidenceIssue(this.eyes.at(-1))?.hint ??
            "Paused · waiting for hand frames.",
          MAX_HAND_RECOVERY_MS
        ),
      })
    }
  }
}
