import type { EspCameraObservation } from "./types"
import {
  ESP_DEFAULT_INVERT_PAN,
  ESP_MAX_PAN_DELTA,
  ESP_PAN_COMMAND_INTERVAL_MS,
} from "./configuration"

type Options = {
  now: () => number
  publish: (delta: number) => void
  invertPan?: boolean
  angle?: number | null
}

export class PanController {
  status: "connected" | "tracking" | "paused" | "stopped" = "connected"
  message = "Select a target, then explicitly start tracking."
  private ready = false
  private lastFrameId = -1
  private lastCapturedAt = -1
  /** Receipt times of independently verified frames; capture age is checked separately. */
  private samples: number[] = []
  private lastCommandAt = -Infinity
  private correctionAt: number | null = null
  private correctionRemainder = 0
  private correctionDirection = 0
  private angle: number | null
  private personMode = false
  private resumeUntil: number | null = null

  constructor(private readonly options: Options) {
    this.angle = options.angle ?? null
  }

  get freshUntil(): number | null {
    if (this.status === "paused") return this.resumeUntil
    const latest = this.samples.at(-1)
    return latest === undefined ? null : latest + 750
  }

  get canArm(): boolean {
    const now = this.options.now()
    return (
      this.ready &&
      this.samples.length === 2 &&
      this.samples.every((time) => now - time < 750) &&
      now - this.lastCapturedAt < 750
    )
  }

  setReady(ready: boolean) {
    if (!ready && this.ready)
      this.stop(
        "MQTT disconnected. Select the target and start tracking again."
      )
    this.ready = ready
  }

  observe(observation: EspCameraObservation): boolean {
    this.checkFreshness()
    const now = this.options.now()
    const { x, confidence, frameId, capturedAt } = observation
    const evidence = observation.personEvidence
    const person = evidence !== undefined
    const identityValid = person
      ? confidence >= 0.65 &&
        Number.isFinite(evidence.detectionConfidence) &&
        evidence.detectionConfidence >= 0.3 &&
        evidence.detectionConfidence <= 1 &&
        Number.isFinite(evidence.identityMargin) &&
        evidence.identityMargin >= 0.08 &&
        evidence.identityMargin <= 1
      : confidence > 0.8
    if (
      !Number.isFinite(x) ||
      x < 0 ||
      x > 1 ||
      !Number.isFinite(confidence) ||
      !identityValid ||
      confidence > 1 ||
      !Number.isSafeInteger(frameId) ||
      frameId < 0 ||
      !Number.isFinite(capturedAt) ||
      now - capturedAt >= 750 ||
      capturedAt - now > 100
    ) {
      this.stop(
        "Target lost or camera frame is stale. Select the target and start tracking again."
      )
      return false
    }
    // Neither a replayed sequence nor a reused capture timestamp renews a lease.
    if (frameId <= this.lastFrameId || capturedAt <= this.lastCapturedAt)
      return false
    if (this.personMode !== person) {
      if (this.samples.length)
        this.stop(
          "Selection evidence changed. Confirm the selected person again."
        )
      this.personMode = person
    }
    this.lastFrameId = frameId
    this.lastCapturedAt = capturedAt
    this.samples = [
      ...this.samples.filter((time) => now - time < 750),
      // Network/vision latency must not consume the next confirmation's arrival
      // window. Only a new frame that passes the capture-age check reaches here.
      now,
    ].slice(-2)
    if (this.status === "paused" && this.canArm) {
      this.status = "tracking"
      this.resumeUntil = null
      this.message = "Selected person reacquired. Following resumed."
    }
    if (this.status !== "tracking") return true
    if (!this.ready) {
      this.stop(
        "MQTT is unavailable. Start tracking again after it reconnects."
      )
      return true
    }
    let delta = this.nextCorrection(x - 0.5, now)
    if (this.options.invertPan ?? ESP_DEFAULT_INVERT_PAN) delta *= -1
    if (this.angle !== null)
      delta = Math.max(-this.angle, Math.min(180 - this.angle, delta))
    if (delta === 0) return true
    // Reserve the interval before publishing so synchronous failure cannot retry it.
    this.lastCommandAt = now
    try {
      this.options.publish(delta)
      if (this.angle !== null) this.angle += delta
    } catch {
      this.stop(
        "Servo command could not be sent. Start tracking again after reconnecting."
      )
    }
    return true
  }

  private resetCorrection() {
    this.correctionAt = null
    this.correctionRemainder = 0
    this.correctionDirection = 0
  }

  private nextCorrection(error: number, now: number): number {
    const distance = Math.abs(error)
    if (distance <= 0.06) {
      this.resetCorrection()
      return 0
    }
    const direction = Math.sign(error)
    if (direction !== this.correctionDirection) {
      this.resetCorrection()
      this.correctionDirection = direction
    }
    if (
      now - this.lastCommandAt < ESP_PAN_COMMAND_INTERVAL_MS ||
      (this.correctionAt !== null &&
        now - this.correctionAt < ESP_PAN_COMMAND_INTERVAL_MS)
    )
      return 0
    // Gentle near center, stronger farther away. Saturate at a 35% offset.
    const offset = Math.min(1, (distance - 0.06) / (0.35 - 0.06))
    const maxSpeed = (ESP_MAX_PAN_DELTA * 1000) / ESP_PAN_COMMAND_INTERVAL_MS
    const degreesPerSecond = 0.8 + (maxSpeed - 0.8) * offset ** 1.5
    // Account for variable network frame rates without catching up after a stall.
    const elapsed =
      this.correctionAt === null
        ? 0.25
        : Math.min(0.5, (now - this.correctionAt) / 1000)
    this.correctionAt = now
    const requested =
      Math.min(ESP_MAX_PAN_DELTA, degreesPerSecond * elapsed) +
      this.correctionRemainder
    const whole = Math.floor(requested + 1e-9)
    this.correctionRemainder = Math.max(0, requested - whole)
    // Firmware accepts whole degrees. Accumulate a small correction instead of
    // forcing a one-degree command on every observation and chattering near center.
    return direction * Math.min(ESP_MAX_PAN_DELTA, whole)
  }

  arm(): boolean {
    this.checkFreshness()
    if (!this.canArm) {
      this.message =
        "Tracking needs MQTT and two fresh, reliable target frames."
      return false
    }
    this.status = "tracking"
    this.resetCorrection()
    this.message = "Following the target with gentle, adaptive X corrections."
    return true
  }

  checkFreshness() {
    if (this.freshUntil !== null && this.options.now() >= this.freshUntil) {
      const latest = this.samples.at(-1)
      if (
        this.status === "tracking" &&
        this.personMode &&
        latest !== undefined &&
        this.options.now() < latest + 2000
      ) {
        this.status = "paused"
        this.resumeUntil = latest + 2000
        this.samples = []
        this.resetCorrection()
        this.message =
          "Waiting for the selected person. Movement paused during the brief stream gap."
        return
      }
      this.stop(
        "Camera frames stopped or the target was lost. Start tracking again to resume."
      )
    }
  }

  stop(
    message = "Tracking stopped. Servos hold their last commanded position."
  ) {
    this.status = "stopped"
    this.message = message
    this.samples = []
    this.resumeUntil = null
    this.resetCorrection()
  }
}
