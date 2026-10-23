import type { SceneCamera } from "./scene-camera"
import type { MutableRefObject } from "react"
import type { GazeBubbleOverlaySnapshot } from "../gaze-bubble/gaze-bubble-overlay.types"
import type { GazeBubbleOverlayProps } from "../gaze-bubble/gaze-bubble-overlay.types"

import type { Point } from "../eye-tracking/eye-tracking.types"

import type { NetworkConnectionState } from "../eye-tracking/network-camera"

import type {
  CalibrationHold,
  CalibrationMethod,
  GazeMeasurement,
  HandObservation,
  SceneObservation,
} from "./scene.types"

import type { MarkerObservation } from "./marker-detector"

export type ScenePreviewProps = {
  canvasRef?: MutableRefObject<HTMLCanvasElement | null>
  gazeSnapshotRef?: MutableRefObject<GazeBubbleOverlaySnapshot | null>
  camera: SceneCamera
  frame: SceneObservation | null
  hand: HandObservation | null
  handRecovering?: boolean
  marker?: MarkerObservation | null
  hideMarkerPattern?: boolean
  method?: CalibrationMethod
  gaze: GazeMeasurement | null
  gazeDisplay?: Pick<
    GazeBubbleOverlayProps,
    | "errorRadiusPx"
    | "verified"
    | "resetKey"
    | "offset"
    | "maxAgeMs"
    | "correction"
  >
  trace: GazeMeasurement[]
  holds: CalibrationHold[]
  capturing: boolean
  target: Point | null
  progress: number
  connection: NetworkConnectionState
}
