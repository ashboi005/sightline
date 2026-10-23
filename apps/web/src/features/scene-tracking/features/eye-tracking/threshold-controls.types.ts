import type { FrameSettings } from "./eye-tracking.types"
import type { TrackerController } from "./use-tracker.types"

export type ThresholdControlsProps = {
  tracker: TrackerController
  update: (next: Partial<FrameSettings>) => void
}
