import type { Point, TrackerFormat } from "../eye-tracking/eye-tracking.types"
import type {
  CalibrationMethod,
  CameraOrientation,
  SceneCalibration,
} from "./scene.types"

export type SceneProfileSetup = {
  fingerprint?: string
  trackerFormat: TrackerFormat
  orientation: CameraOrientation
}

export type SceneProfileCalibration = {
  calibration: SceneCalibration
  method: CalibrationMethod
  offset: Point
  delayMs: number
  /** Save unfinished accuracy checks without promoting them to reusable estimates. */
  unverified?: boolean
}

export type SceneCalibrationProfile = SceneProfileCalibration & {
  id: string
  name: string
  updatedAt: string
  setup: SceneProfileSetup
}

export type SceneProfileLibrary = {
  version: 1
  selectedId: string | null
  profiles: SceneCalibrationProfile[]
}
