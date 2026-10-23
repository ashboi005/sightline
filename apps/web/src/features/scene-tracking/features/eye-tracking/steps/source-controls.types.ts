import type { CameraSourceRole } from "../use-camera-source-preferences.types"
import type { TrackerController } from "../use-tracker.types"

export type SourceControlsProps = {
  excludedDeviceId?: string
  tracker: TrackerController
  role?: CameraSourceRole
  resetSource: () => void
}
