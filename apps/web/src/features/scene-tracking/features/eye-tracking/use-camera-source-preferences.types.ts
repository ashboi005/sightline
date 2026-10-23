export type CameraSourceKind = "usb" | "network"

export type CameraSourcePreferences = {
  kind: CameraSourceKind
  url: string
  deviceId: string
}

export type CameraSourcePreferenceController = CameraSourcePreferences & {
  setKind: (kind: CameraSourceKind) => void
  setUrl: (url: string) => void
  setDeviceId: (deviceId: string) => void
}

export type CameraSourceRole =
  | "eye"
  | "scene-eye"
  | "scene"
  | "head"
  | "remote-mobile"
  | "remote-webcam"
  | "remote-ir"

export type CameraSourceSnapshot = {
  kind: string
  url?: string
  deviceId?: string
}
