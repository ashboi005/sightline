import type {
  FrameDimensions,
  FrameSettings,
  Point,
  TrackerFormat,
} from "./eye-tracking.types"
import { clampRegion } from "./roi"
import type {
  PersistedFrameSettings,
  SavedTrackerPreferences,
  SerializedTrackerPreferences,
  TrackerPreferenceMap,
} from "./tracker-preferences.types"
const STORAGE_KEY = "sightline.eye-tracking.preferences.v1"
const TRACKER_FORMATS: readonly TrackerFormat[] = ["classic", "spatial"]
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function isDimension(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 16384
  )
}
function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (coordinate) =>
        typeof coordinate === "number" &&
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <= 16384
    )
  )
}
function isValidSettings(
  format: TrackerFormat,
  value: Record<string, unknown>,
  dimensions: FrameDimensions
): value is Record<string, unknown> & PersistedFrameSettings {
  const roi = value.roi
  const corners = value.corners
  const thresholdMode = value.thresholdMode
  const threshold = value.threshold
  const usesManualThreshold = format === "classic" || thresholdMode === "manual"
  const minimumThreshold = usesManualThreshold ? 0 : -50
  const maximumThreshold = usesManualThreshold ? 255 : 80
  if (!isRecord(roi)) {
    return false
  }
  const roiValues = [roi.x, roi.y, roi.width, roi.height]
  const validRoi =
    roiValues.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isSafeInteger(coordinate)
    ) &&
    Number(roi.x) >= 0 &&
    Number(roi.y) >= 0 &&
    Number(roi.width) > 0 &&
    Number(roi.height) > 0 &&
    Number(roi.x) + Number(roi.width) <= dimensions.width &&
    Number(roi.y) + Number(roi.height) <= dimensions.height
  const validCorners =
    corners === null ||
    (Array.isArray(corners) &&
      corners.length === 2 &&
      isPoint(corners[0]) &&
      isPoint(corners[1]))
  return (
    value.format === format &&
    validRoi &&
    validCorners &&
    (thresholdMode === "auto" || thresholdMode === "manual") &&
    typeof threshold === "number" &&
    Number.isFinite(threshold) &&
    threshold >= minimumThreshold &&
    threshold <= maximumThreshold &&
    typeof value.fov === "number" &&
    Number.isFinite(value.fov) &&
    value.fov >= 10 &&
    value.fov <= 140 &&
    typeof value.radiusMm === "number" &&
    Number.isFinite(value.radiusMm) &&
    value.radiusMm >= 8 &&
    value.radiusMm <= 16
  )
}
function parseSavedPreferences(
  format: TrackerFormat,
  value: unknown
): SavedTrackerPreferences | null {
  if (!isRecord(value) || !isRecord(value.frameDimensions)) {
    return null
  }
  const width = value.frameDimensions.width
  const height = value.frameDimensions.height
  if (
    !isDimension(width) ||
    !isDimension(height) ||
    !isRecord(value.settings)
  ) {
    return null
  }
  const frameDimensions = { width, height }
  if (!isValidSettings(format, value.settings, frameDimensions)) {
    return null
  }
  const settings: PersistedFrameSettings = {
    format,
    roi: {
      x: Number(value.settings.roi.x),
      y: Number(value.settings.roi.y),
      width: Number(value.settings.roi.width),
      height: Number(value.settings.roi.height),
    },
    threshold: Number(value.settings.threshold),
    thresholdMode: value.settings.thresholdMode,
    fov: Number(value.settings.fov),
    radiusMm: Number(value.settings.radiusMm),
    corners:
      value.settings.corners === null
        ? null
        : [
            [
              Number(value.settings.corners[0][0]),
              Number(value.settings.corners[0][1]),
            ],
            [
              Number(value.settings.corners[1][0]),
              Number(value.settings.corners[1][1]),
            ],
          ],
  }
  return { frameDimensions, settings }
}
export function readTrackerPreferences(): TrackerPreferenceMap {
  try {
    const serialized = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!serialized) {
      return {}
    }
    const value: unknown = JSON.parse(serialized)
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.trackers)) {
      return {}
    }
    const preferences: TrackerPreferenceMap = {}
    for (const format of TRACKER_FORMATS) {
      const saved = parseSavedPreferences(format, value.trackers[format])
      if (saved) {
        preferences[format] = saved
      }
    }
    return preferences
  } catch {
    return {}
  }
}
export function saveTrackerPreferences(
  current: TrackerPreferenceMap,
  settings: FrameSettings,
  frameDimensions: FrameDimensions
): TrackerPreferenceMap {
  const savedSettings: PersistedFrameSettings = {
    format: settings.format,
    roi: { ...settings.roi },
    threshold: settings.threshold,
    thresholdMode:
      settings.thresholdMode ??
      (settings.format === "classic" ? "manual" : "auto"),
    fov: settings.fov,
    radiusMm: settings.radiusMm,
    corners: settings.corners
      ? [[...settings.corners[0]], [...settings.corners[1]]]
      : null,
  }
  const next: TrackerPreferenceMap = {
    ...current,
    [settings.format]: {
      frameDimensions: { ...frameDimensions },
      settings: savedSettings,
    },
  }
  try {
    const serializedPreferences: SerializedTrackerPreferences = {
      version: 1,
      trackers: next,
    }
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify(serializedPreferences)
    )
  } catch {
    // Tracking remains usable when local storage is unavailable or full.
  }
  return next
}
export function resizeTrackerSettings(
  saved: SavedTrackerPreferences,
  dimensions: FrameDimensions
): FrameSettings {
  const scaleX = dimensions.width / saved.frameDimensions.width
  const scaleY = dimensions.height / saved.frameDimensions.height
  const scaledRegion = clampRegion(
    {
      x: saved.settings.roi.x * scaleX,
      y: saved.settings.roi.y * scaleY,
      width: saved.settings.roi.width * scaleX,
      height: saved.settings.roi.height * scaleY,
    },
    dimensions
  )
  const corners = saved.settings.corners?.map((point): Point => [
    Math.max(0, Math.min(dimensions.width, Math.round(point[0] * scaleX))),
    Math.max(0, Math.min(dimensions.height, Math.round(point[1] * scaleY))),
  ]) as [Point, Point] | undefined
  return {
    ...saved.settings,
    roi: scaledRegion,
    corners: corners ?? null,
    locked: false,
  }
}
