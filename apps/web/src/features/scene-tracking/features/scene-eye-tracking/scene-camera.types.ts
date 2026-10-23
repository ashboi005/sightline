import type { NetworkConnectionState } from "../eye-tracking/network-camera"

import type { CameraTransform } from "../eye-tracking/camera-transform"

import type { SceneObservation } from "./scene.types"

export type SceneSource = {
  kind: "camera" | "network"
  name: string
  key: string
  deviceId?: string
  url?: string
}

export type SceneCameraSnapshot = {
  source: SceneSource | null
  busy: boolean
  error: string
  devices: MediaDeviceInfo[]
  frame: SceneObservation | null
  connection: NetworkConnectionState
  retryAttempt: number
  transform: CameraTransform
}
