import type { FrameSettings, Point } from "../eye-tracking.types"
import type { TrackerController } from "../use-tracker.types"

export type ModelControlsProps = {
  tracker: TrackerController
  corner: Point | null
  update: (next: Partial<FrameSettings>) => void
  setNotice: (message: string) => void
}
