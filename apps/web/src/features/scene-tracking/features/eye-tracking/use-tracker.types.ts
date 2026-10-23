import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { CameraTransform } from "./camera-transform"
import type {
  FrameDimensions,
  FrameSettings,
  Point,
  TrackingFrame,
} from "./eye-tracking.types"
import type {
  NetworkCamera,
  NetworkCameraFrame,
  NetworkConnectionState,
} from "./network-camera"

export type TrackerSource = {
  kind: "camera" | "network" | "video" | "sample"
  name: string
  deviceId?: string
  url?: string
  key?: string
}

export type TrackerRuntimeState = {
  settings: FrameSettings
  source: TrackerSource | null
  video: HTMLVideoElement | null
  network: NetworkCamera | null
  networkFrame: NetworkCameraFrame | null
  lastNetworkSequence: number
  networkInterruptedAt: number
  transform: CameraTransform
  inputDimensions: FrameDimensions
  stream: MediaStream | null
  url: string
  generation: number
  sourceEpoch: number
  sequence: number
  inflight: boolean
  inflightGeneration: number
  worker: Worker | null
  ready: boolean
  previewMasksEnabled: boolean
  sampleTarget: Point | null
  blink: boolean
  lastVideoTime: number
}

export type TrackerRuntime = {
  control: MutableRefObject<TrackerRuntimeState>
  latest: MutableRefObject<TrackingFrame | null>
}

export type TrackerController = {
  transform: CameraTransform
  setTransform: (value: CameraTransform) => void
  connection: NetworkConnectionState
  reconnectAttempt: number
  dimensions: FrameDimensions
  settings: FrameSettings
  configure: (next: Partial<FrameSettings>, invalidate?: boolean) => void
  frame: TrackingFrame | null
  latest: MutableRefObject<TrackingFrame | null>
  source: TrackerSource | null
  sourceCanvas: MutableRefObject<HTMLCanvasElement | null>
  busy: boolean
  error: string
  setError: Dispatch<SetStateAction<string>>
  engineReady: boolean
  devices: MediaDeviceInfo[]
  startCamera: (deviceId: string, excludedDeviceId?: string) => Promise<void>
  startNetworkStream: (input: string) => Promise<void>
  startVideo: (file: File) => Promise<void>
  startSample: () => void
  stop: () => void
  setSampleTarget: (point: Point | null) => void
  setPreviewMasksEnabled: (enabled: boolean) => void
  setBlink: (value: boolean) => void
}
