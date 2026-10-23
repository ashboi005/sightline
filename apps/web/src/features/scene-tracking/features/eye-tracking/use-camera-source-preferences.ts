import { useEffect, useMemo, useState } from "react"
import type {
  CameraSourceKind,
  CameraSourcePreferenceController,
  CameraSourcePreferences,
  CameraSourceRole,
  CameraSourceSnapshot,
} from "./use-camera-source-preferences.types"
const DEFAULT_PREFERENCES: CameraSourcePreferences = {
  kind: "usb",
  url: "",
  deviceId: "",
}
function readCameraSourcePreferences(
  key: string,
  fallbackKey?: string
): CameraSourcePreferences {
  try {
    let serialized = globalThis.localStorage?.getItem(key)
    if (!serialized && fallbackKey) {
      serialized = globalThis.localStorage?.getItem(fallbackKey)
    }
    if (!serialized) {
      return DEFAULT_PREFERENCES
    }
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return DEFAULT_PREFERENCES
    }
    let kind: CameraSourceKind = "usb"
    let url = ""
    let deviceId = ""
    if ("kind" in value && value.kind === "network") {
      kind = "network"
    }
    if ("url" in value && typeof value.url === "string") {
      url = value.url
    }
    if ("deviceId" in value && typeof value.deviceId === "string") {
      deviceId = value.deviceId
    }
    return { kind, url, deviceId }
  } catch {
    return DEFAULT_PREFERENCES
  }
}
export function useCameraSourcePreferences(
  role: CameraSourceRole = "eye",
  source?: CameraSourceSnapshot | null
): CameraSourcePreferenceController {
  const key = `sightline.${role}-camera.source.v1`
  const saved = useMemo(() => {
    // Scene and screen formerly shared one eye-camera preference.
    const fallbackKey =
      role === "scene-eye" ? "sightline.eye-camera.source.v1" : undefined
    return readCameraSourcePreferences(key, fallbackKey)
  }, [key, role])
  const [selection, setSelection] = useState(() => {
    let preferences = saved
    if (source) {
      preferences = {
        ...saved,
        kind: source.kind === "network" ? "network" : "usb",
        url: source.url ?? saved.url,
        deviceId: source.deviceId ?? saved.deviceId,
      }
    }
    return { key, preferences }
  })
  // Remote camera modes can change without unmounting the page. Never copy
  // the previous mode's device or URL into the newly selected mode's key.
  const preferences = selection.key === key ? selection.preferences : saved
  function updatePreferences(patch: Partial<CameraSourcePreferences>): void {
    setSelection((current) => {
      const previous = current.key === key ? current.preferences : saved
      return { key, preferences: { ...previous, ...patch } }
    })
  }
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(preferences))
    } catch {
      // Camera controls remain usable when browser storage is unavailable.
    }
  }, [key, preferences])
  function setKind(kind: CameraSourceKind): void {
    updatePreferences({ kind })
  }
  function setUrl(url: string): void {
    updatePreferences({ url })
  }
  function setDeviceId(deviceId: string): void {
    updatePreferences({ deviceId })
  }
  return { ...preferences, setKind, setUrl, setDeviceId }
}

export function readSceneSourcePreferences(): CameraSourcePreferences {
  const saved = readCameraSourcePreferences("sightline.scene-camera.source.v1");
  try {
    if (!localStorage.getItem("sightline.scene-camera.source.v1")) return { ...saved, deviceId: localStorage.getItem("sightline.scene-camera") ?? "" };
  } catch {}
  return saved;
}
export function writeSceneSourcePreferences(value: CameraSourcePreferences) {
  try { localStorage.setItem("sightline.scene-camera.source.v1", JSON.stringify(value)); } catch {}
}
