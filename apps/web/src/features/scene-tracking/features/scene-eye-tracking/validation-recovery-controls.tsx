import { Crosshair, Download, Move, RefreshCw } from "lucide-react"
import { GazeOffsetControls } from "../eye-tracking/components/gaze-offset-controls"
import {
  EyeActionIconStyles,
  EyeButtonStyles,
  EyeGuidanceRowStyles,
} from "../tracking-ui/control-styles"
import {
  SceneMetricsStyles,
  ScenePreviewWarningStyles,
  SceneValidationPointsStyles,
  SceneValidationRecoveryStyles,
} from "../tracking-ui/scene-styles"
import { download } from "./download"
import type { ValidationRecoveryControlsProps } from "./validation-recovery-controls.types"
export function ValidationRecoveryControls({
  onCorrect,
  session,
  state,
  canCapture,
  prepare = () => {},
}: ValidationRecoveryControlsProps) {
  const result = state.validation
  const dimensions = state.calibration?.holds[0]?.pairs[0]
  if (!result || result.passed || !dimensions) {
    return null
  }
  const suggested = result.suggestedOffset
  const unchanged = state.offset.every(
    (value, i) => value === (result.offset?.[i] ?? 0)
  )
  const position = state.measurement?.preview
    ? state.measurement.position
    : null
  return (
    <div
      className={`scene-validation-recovery ${SceneValidationRecoveryStyles}`}
    >
      <div className={`eye-guidance-row ${EyeGuidanceRowStyles}`}>
        <span className={`scene-preview-warning ${ScenePreviewWarningStyles}`}>
          Unverified preview
        </span>
        <button
          className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
          aria-label="Download calibration diagnostics"
          data-tooltip="Save check diagnostics"
          title="Save calibration, validation pairs, per-point errors and the applied offset on this device"
          onClick={() =>
            download(
              new Blob(
                [
                  JSON.stringify(
                    {
                      version: 1,
                      delayMs: state.delayMs,
                      offset: state.offset,
                      calibration: state.calibration,
                      validation: result,
                      validationHolds: state.collection?.holds,
                    },
                    null,
                    2
                  ),
                ],
                { type: "application/json" }
              ),
              "scene-calibration-diagnostics.json"
            )
          }
        >
          <Download size={16} aria-hidden="true" />
        </button>
      </div>
      <div className={`scene-metrics ${SceneMetricsStyles}`}>
        <div>
          <span>
            {unchanged ? "Accuracy check" : "Previous accuracy check"}
          </span>
          <strong>
            {result.pixelRms.toFixed(1)} px RMS · worst{" "}
            {result.maxPixelError.toFixed(1)} px
          </strong>
        </div>
        {result.points && (
          <div
            className={`scene-validation-points ${SceneValidationPointsStyles}`}
            aria-label="Error at each validation point"
          >
            {result.points.map((point) => (
              <span
                key={point.index}
                title={`Point ${point.index + 1}: X error ${point.pixelDelta[0].toFixed(1)} px, Y error ${point.pixelDelta[1].toFixed(1)} px. Positive is right/down from the fingertip.`}
              >
                <small>{point.index + 1}</small>
                {point.pixelError.toFixed(0)} px
              </span>
            ))}
          </div>
        )}
        <div>
          <span>Gaze preview</span>
          <strong>
            {position
              ? `${(position[0] * 100).toFixed(1)}%, ${(position[1] * 100).toFixed(1)}%`
              : "Waiting…"}
          </strong>
        </div>
      </div>
      <GazeOffsetControls
        onCorrect={onCorrect}
        offset={state.offset}
        width={dimensions.width}
        height={dimensions.height}
        disabled={!!state.capture}
        onChange={(offset) => session.setOffset(offset)}
      />
      {suggested && unchanged && (
        <button
          className={`eye-button ${EyeButtonStyles} primary`}
          aria-label="Apply suggested offset as unverified preview"
          title={`Try X ${(suggested[0] * dimensions.width).toFixed(1)} px, Y ${(suggested[1] * dimensions.height).toFixed(1)} px as an unverified preview. The nine calibration points are kept.`}
          disabled={!!state.capture}
          onClick={() => session.setOffset(suggested)}
        >
          <Move size={16} aria-hidden="true" /> Apply offset
        </button>
      )}
      {result.retryIndex != null && unchanged && (
        <button
          className={`eye-button ${EyeButtonStyles} primary`}
          disabled={!canCapture}
          onClick={() => {
            prepare()
            session.retryValidationPoint()
          }}
        >
          <RefreshCw size={16} aria-hidden="true" /> Repeat point{" "}
          {result.retryIndex + 1}
        </button>
      )}
      <button
        className={`eye-button ${EyeButtonStyles} secondary`}
        disabled={!canCapture}
        onClick={() => {
          prepare()
          session.startCapture("validation")
        }}
      >
        <Crosshair size={16} aria-hidden="true" /> Check again
      </button>
    </div>
  )
}
