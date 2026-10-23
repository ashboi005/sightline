import { Crosshair, Eye } from "lucide-react"
import { EyePreview } from "../eye-tracking/components/eye-preview"
import {
  SceneEyePreviewStyles,
  SceneEyeStateStyles,
  SceneEyeStatusStyles,
  SceneMainPreviewStyles,
  SceneStatusStripStyles,
} from "../tracking-ui/scene-styles"
import { MIN_EYE_CONFIDENCE } from "./calibration"
import type { CalibrationEyePreviewProps } from "./calibration-eye-preview.types"
const noEdit = () => {}
export function CalibrationEyePreview({
  tracker,
  evidence,
}: CalibrationEyePreviewProps) {
  const confidence =
    evidence.confidence !== null && Number.isFinite(evidence.confidence)
      ? `${Math.round(evidence.confidence * 100)}%`
      : "—"
  const direction = tracker.frame?.gaze?.direction
  const details = [
    evidence.hint,
    tracker.frame?.detection.reason,
    direction
      ? `Gaze vector: ${direction.map((value) => value.toFixed(3)).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <section
      className={`scene-main-preview ${SceneMainPreviewStyles} scene-eye-preview ${SceneEyePreviewStyles}`}
      aria-label="Calibration eye camera"
    >
      <EyePreview
        tracker={tracker}
        readOnly
        showModel
        selectRegion={false}
        cornerMode={null}
        pendingCorner={null}
        onRegion={noEdit}
        onCorner={noEdit}
        onCornerModeChange={noEdit}
        onMoveCorners={noEdit}
        onMovePendingCorner={noEdit}
      />
      <div
        className={`scene-status-strip ${SceneStatusStripStyles} scene-eye-status ${SceneEyeStatusStyles}`}
      >
        <span
          title={`Pupil confidence · ${Math.round(MIN_EYE_CONFIDENCE * 100)}% minimum for calibration`}
          aria-label={`Pupil confidence ${confidence}`}
        >
          <Eye size={16} aria-hidden="true" /> {confidence}
        </span>
        <span
          className={`scene-eye-state ${SceneEyeStateStyles} ${evidence.ready ? "ready" : "waiting"}`}
          title={details}
          aria-label={evidence.hint}
        >
          <Crosshair size={16} aria-hidden="true" /> {evidence.hint}
        </span>
      </div>
    </section>
  )
}
