export type NetworkConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "waiting"
  | "reconnecting"
  | "error"

export type NetworkCameraFrame = {
  image: HTMLVideoElement | ImageBitmap
  width: number
  height: number
  timestamp: number
  sequence: number
}

export type Callbacks = {
  onFrame: (frame: NetworkCameraFrame | null) => void
  onStatus: (
    state: NetworkConnectionState,
    attempt: number,
    detail?: string
  ) => void
  onError: (message: string) => void
}

export type NetworkCameraBytes = { bytes: Uint8Array; timestamp: number }
