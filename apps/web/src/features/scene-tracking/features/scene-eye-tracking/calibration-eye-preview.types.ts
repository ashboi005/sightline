import type { TrackerController } from "../eye-tracking/use-tracker.types"

import type { sceneEyeEvidence } from "./eye-evidence"

export type CalibrationEyePreviewProps = {
  tracker: TrackerController
  evidence: ReturnType<typeof sceneEyeEvidence>
}
