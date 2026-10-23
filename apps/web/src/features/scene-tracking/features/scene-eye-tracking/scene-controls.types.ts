import type { SceneCamera, SceneCameraSnapshot } from "./scene-camera"

import type { HandTrackerSnapshot } from "./hand-tracker"

import type { FrameDimensions } from "../eye-tracking/eye-tracking.types"
import type { SceneSession, SceneSessionSnapshot } from "./scene-session"
import type { CalibrationMethod } from "./scene.types"

export type SceneLiveControlsProps = {
  onCorrect: () => void
  session: SceneSession
  state: SceneSessionSnapshot
  onCalibrate: () => void
  canValidate: boolean
  recording?: boolean
  onMethodChange?: (method: CalibrationMethod) => void
  sceneDimensions?: FrameDimensions
}

export type SceneSourceControlsProps = {
  camera: SceneCamera
  state: SceneCameraSnapshot
  eyeDeviceId?: string
  onConnected: () => void
  active?: boolean
}

export type FingerControlsProps = {
  onCorrect: () => void
  session: SceneSession
  state: SceneSessionSnapshot
  hands: Pick<HandTrackerSnapshot, "status" | "error">
  canCapture: boolean
  retry: () => void
  onLive: () => void
}

export type SceneOffsetInput = {
  axis: number
  value: string
}
