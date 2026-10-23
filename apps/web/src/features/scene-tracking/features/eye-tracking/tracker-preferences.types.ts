import type {
  FrameDimensions,
  FrameSettings,
  TrackerFormat,
} from "./eye-tracking.types"

export type PersistedFrameSettings = Omit<FrameSettings, "locked">

export type SavedTrackerPreferences = {
  frameDimensions: FrameDimensions
  settings: PersistedFrameSettings
}

export type TrackerPreferenceMap = Partial<
  Record<TrackerFormat, SavedTrackerPreferences>
>

export type SerializedTrackerPreferences = {
  version: 1
  trackers: TrackerPreferenceMap
}
