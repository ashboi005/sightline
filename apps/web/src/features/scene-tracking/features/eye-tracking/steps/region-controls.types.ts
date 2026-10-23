import type { Rect } from "../eye-tracking.types"
import type { TrackerController } from "../use-tracker.types"

export type RegionDraft = {
  original: Rect
  values: Record<keyof Rect, string>
}

export type RegionControlsProps = {
  tracker: TrackerController
  chooseRegion: (roi: Rect) => void
}
