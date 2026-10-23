import type { CameraDiscovery } from "./camera-http"
import { validateCameraUrl } from "./camera-http"
import {
  ESP_DEFAULT_INVERT_PAN,
  SERVO_TOPIC_PATTERN,
  type ServoConfiguration,
} from "./configuration"
import { PanController } from "./pan-controller"
import type {
  EspCameraReply,
  EspCameraRequest,
  EspCameraStatus,
  ServoGateway,
} from "./types"

export class CameraServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

type Dependencies = {
  configuration: ServoConfiguration
  now: () => number
  id: () => string
  schedule: (callback: () => void, delay: number) => () => void
  createGateway: (
    configuration: ServoConfiguration,
    onConnectionChange: (ready: boolean) => void
  ) => ServoGateway
  discover: (url: string, signal?: AbortSignal) => Promise<CameraDiscovery>
}

type Session = {
  id: string
  user: string
  topic: string
  url: string
  invertPan: boolean
  intent: number
  expiresAt: number
  camera: EspCameraStatus | null
  discovery: boolean
  localReady: boolean
  gateway: ServoGateway
  controller: PanController
  abort: AbortController
  cancelLease: () => void
  cancelFreshness: () => void
  cancelPoll: () => void
}

const noCancel = () => {}
const SESSION_LEASE_MS = 30_000

function validateVideoReference(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CameraServiceError("Enter a valid HTTP or HTTPS camera URL.")
  }
  if (
    input.length > 512 ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new CameraServiceError(
      "Use an HTTP or HTTPS camera URL without embedded credentials."
    )
  }
  return url
}

/** One process owns each topic. Run this gateway in one persistent Node server. */
export class EspCameraService {
  private sessions = new Map<string, Session>()
  private owners = new Set<string>()

  constructor(private readonly dependencies: Dependencies) {}

  async connect(
    user: string,
    request: Extract<EspCameraRequest, { action: "connect" }>
  ): Promise<EspCameraReply> {
    const configuredTopic = this.dependencies.configuration.topic
    // A hosted gateway never fetches this video reference. LAN restrictions apply
    // only to the optional local discovery path that actually requests /status.
    const url = configuredTopic
      ? validateVideoReference(request.url)
      : validateCameraUrl(request.url)
    const reservation = configuredTopic || `discover:${url.hostname}`
    if (this.owners.has(reservation))
      throw new CameraServiceError(
        "This camera already has a controller. Disconnect its existing session first.",
        409
      )
    if (this.owners.size >= 16)
      throw new CameraServiceError("Too many active camera sessions.", 429)
    this.owners.add(reservation)
    let topic = configuredTopic
    let gateway: ServoGateway | undefined
    try {
      const discovered = configuredTopic
        ? null
        : await this.dependencies.discover(url.href)
      topic = configuredTopic || discovered?.topic || ""
      if (!SERVO_TOPIC_PATTERN.test(topic))
        throw new CameraServiceError(
          "Configure the device's exact MQTT servo topic."
        )
      if (topic !== reservation && this.owners.has(topic))
        throw new CameraServiceError(
          "This camera already has a controller.",
          409
        )
      this.owners.add(topic)
      const controller = new PanController({
        now: this.dependencies.now,
        publish: (delta) => gateway!.publish(delta),
        invertPan: request.invertPan ?? ESP_DEFAULT_INVERT_PAN,
        angle: discovered?.camera.servoX ?? null,
      })
      let session: Session | undefined
      gateway = this.dependencies.createGateway(
        { ...this.dependencies.configuration, topic },
        (ready) => {
          controller.setReady(
            ready && (!session?.discovery || session.localReady)
          )
        }
      )
      session = {
        id: this.dependencies.id(),
        user,
        topic,
        url: url.href,
        invertPan: request.invertPan ?? ESP_DEFAULT_INVERT_PAN,
        intent: 0,
        expiresAt: 0,
        camera: discovered?.camera ?? null,
        discovery: discovered !== null,
        localReady: discovered
          ? discovered.camera.servoReady && discovered.camera.servoMqttConnected
          : true,
        gateway,
        controller,
        abort: new AbortController(),
        cancelLease: noCancel,
        cancelFreshness: noCancel,
        cancelPoll: noCancel,
      }
      this.sessions.set(session.id, session)
      controller.setReady(gateway.connected && session.localReady)
      this.touch(session)
      if (session.discovery) this.schedulePoll(session)
      return this.reply(session)
    } catch (error) {
      gateway?.close()
      // Never release a topic already held by another session after discovery conflicts.
      if (
        topic === reservation ||
        ![...this.sessions.values()].some((session) => session.topic === topic)
      )
        this.owners.delete(topic)
      throw error
    } finally {
      if (
        reservation !== topic ||
        ![...this.sessions.values()].some((session) => session.topic === topic)
      )
        this.owners.delete(reservation)
    }
  }

  execute(
    user: string,
    request: Exclude<EspCameraRequest, { action: "connect" }>
  ): EspCameraReply {
    const session = this.requireSession(user, request.sessionId)
    session.controller.setReady(session.gateway.connected && session.localReady)
    session.controller.checkFreshness()
    if (request.action === "disconnect") {
      const reply = this.reply(session)
      this.remove(session)
      return {
        ...reply,
        status: "disconnected",
        mqttConnected: false,
        canArm: false,
        message: "Disconnected. Servos hold their last commanded position.",
      }
    }
    if (request.action === "observe") {
      if (request.intent !== session.intent) return this.reply(session)
      if (session.controller.observe(request.observation)) this.touch(session)
      this.scheduleFreshness(session)
    } else if (request.action === "arm" || request.action === "stop") {
      if (
        !Number.isSafeInteger(request.intent) ||
        request.intent <= session.intent
      )
        return this.reply(session)
      session.intent = request.intent
      if (request.action === "stop") session.controller.stop()
      else session.controller.arm()
      this.touch(session)
      this.scheduleFreshness(session)
    } else {
      this.touch(session)
    }
    return this.reply(session)
  }

  /** Releases all MQTT clients and timers when the server is replaced or shut down. */
  disconnectAll() {
    for (const session of this.sessions.values()) this.remove(session)
  }

  private requireSession(user: string, id: string): Session {
    const session = this.sessions.get(id)
    if (!session || session.user !== user)
      throw new CameraServiceError(
        "Camera session was not found or has expired.",
        404
      )
    if (this.dependencies.now() >= session.expiresAt) {
      this.remove(session)
      throw new CameraServiceError(
        "Camera session expired. Connect again.",
        410
      )
    }
    return session
  }

  private reply(session: Session): EspCameraReply {
    const telemetry = session.camera ? "available" : "unavailable"
    const connection = session.gateway.connected
      ? "MQTT broker connected; device telemetry unavailable."
      : "Connecting to the MQTT broker; device telemetry unavailable."
    return {
      sessionId: session.id,
      status: session.controller.status,
      message:
        session.controller.status === "connected" && !session.camera
          ? `${session.controller.message} ${connection}`
          : session.controller.message,
      camera: session.camera,
      mqttConnected: session.gateway.connected,
      deviceTelemetry: telemetry,
      invertPan: session.invertPan,
      leaseExpiresAt: session.expiresAt,
      intent: session.intent,
      canArm: session.controller.canArm,
      serverTime: this.dependencies.now(),
    }
  }

  private touch(session: Session) {
    session.expiresAt = this.dependencies.now() + SESSION_LEASE_MS
    session.cancelLease()
    session.cancelLease = this.dependencies.schedule(
      () => this.remove(session),
      SESSION_LEASE_MS
    )
  }

  private scheduleFreshness(session: Session) {
    session.cancelFreshness()
    const until = session.controller.freshUntil
    session.cancelFreshness =
      until === null
        ? noCancel
        : this.dependencies.schedule(
            () => {
              session.controller.checkFreshness()
              this.scheduleFreshness(session)
            },
            Math.max(0, until - this.dependencies.now())
          )
  }

  private schedulePoll(session: Session) {
    session.cancelPoll = this.dependencies.schedule(() => {
      void this.poll(session)
    }, 500)
  }

  private async poll(session: Session) {
    try {
      const discovered = await this.dependencies.discover(
        session.url,
        session.abort.signal
      )
      if (discovered.topic !== session.topic)
        throw new Error("The device topic changed.")
      session.camera = discovered.camera
      session.localReady =
        discovered.camera.servoReady && discovered.camera.servoMqttConnected
    } catch {
      session.camera = null
      session.localReady = false
      session.controller.stop(
        "Camera status is unavailable. Reconnect and start tracking again."
      )
    }
    session.controller.setReady(session.gateway.connected && session.localReady)
    if (this.sessions.get(session.id) === session) this.schedulePoll(session)
  }

  private remove(session: Session) {
    session.controller.stop()
    session.cancelLease()
    session.cancelFreshness()
    session.cancelPoll()
    session.abort.abort()
    session.gateway.close()
    this.sessions.delete(session.id)
    this.owners.delete(session.topic)
  }
}
