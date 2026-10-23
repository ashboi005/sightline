export type EspCameraObservation = {
  /** Horizontal target center in the original, untransformed camera image. */
  x: number
  confidence: number
  frameId: number
  capturedAt: number
  /** Actual ReID cosine and independent detection/separation evidence, not a probability. */
  personEvidence?: { detectionConfidence: number; identityMargin: number }
}

export type EspCameraStatus = {
  servoReady: boolean
  servoMqttConnected: boolean
  servoX: number
  servoY: number
  width: number
  height: number
}

export type EspCameraRequest =
  | { action: "connect"; url: string; invertPan?: boolean }
  | {
      action: "observe"
      sessionId: string
      intent: number
      observation: EspCameraObservation
    }
  | { action: "arm" | "stop"; sessionId: string; intent: number }
  | { action: "status" | "disconnect"; sessionId: string }

export type EspCameraReply = {
  sessionId: string
  status:
    | "connected"
    | "tracking"
    | "paused"
    | "stopped"
    | "disconnected"
    | "error"
  message: string
  camera: EspCameraStatus | null
  mqttConnected: boolean
  deviceTelemetry: "available" | "unavailable"
  invertPan: boolean
  leaseExpiresAt: number
  intent: number
  canArm: boolean
  serverTime: number
}

export interface ServoGateway {
  readonly connected: boolean
  publish(delta: number): void
  close(): void
}
