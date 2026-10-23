import { ChevronDown, RotateCcw, ScanEye } from "lucide-react"
import {
  EyeActionRowStyles,
  EyeDetailsStyles,
  EyeFieldStyles,
  EyeGuidanceRowStyles,
  EyeMutedStyles,
  EyeNumberGridStyles,
  EyeProgressTrackStyles,
} from "../../tracking-ui/control-styles"
import { EyeActionButton } from "../components/eye-action-button"
import { HelpTip } from "../components/help-tip"
import { SpherePreview } from "../components/sphere-preview"
import { getTrackerModelLockStatus } from "../eye-model"
import type { Point } from "../eye-tracking.types"
import type { ModelControlsProps } from "./model-controls.types"
export function ModelControls({
  tracker,
  corner,
  update,
  setNotice,
}: ModelControlsProps) {
  const { settings, frame } = tracker
  const lockStatus = getTrackerModelLockStatus(
    settings,
    tracker.dimensions,
    frame?.model ?? null
  )
  let modelHeading = "Look around the full range."
  let modelGuidance = "Move your gaze toward each edge and corner."
  if (lockStatus.blocker === "coverage") {
    const directionsRemaining = Math.max(
      0,
      lockStatus.requiredDirections - lockStatus.coveredDirections
    )
    let directionLabel = "directions"
    if (directionsRemaining === 1) {
      directionLabel = "direction"
    }
    modelHeading = "Explore a few directions."
    modelGuidance = `Keep your head still. Move your pupil into ${directionsRemaining} more distinct ${directionLabel} in the camera preview.`
  } else if (lockStatus.ready) {
    modelHeading = "Ready to lock."
    modelGuidance = "The eye model has a stable fit across enough movement."
  }
  let cornerDescription = "Pick two eye corners."
  if (corner) {
    cornerDescription = "Pick the opposite corner."
  } else if (settings.corners) {
    cornerDescription = "Points saved."
  }
  function resetCorners(): void {
    update({
      corners: [
        [
          settings.roi.x + settings.roi.width * 0.15,
          settings.roi.y + settings.roi.height * 0.5,
        ],
        [
          settings.roi.x + settings.roi.width * 0.85,
          settings.roi.y + settings.roi.height * 0.5,
        ],
      ],
    })
  }
  return (
    <>
      <SpherePreview frame={frame} />
      {settings.format === "classic" ? (
        <>
          <div className={`eye-guidance-row ${EyeGuidanceRowStyles}`}>
            <p
              className={`eye-muted ${EyeMutedStyles}`}
              role="status"
              aria-live="polite"
            >
              {cornerDescription}
            </p>
            <HelpTip
              label="Manual eye model help"
              text="Create: pick the inner, then outer eye corner. Edit: drag a red + to resize, or drag inside the circle to move."
            />
          </div>
          <div className={`eye-number-grid ${EyeNumberGridStyles}`}>
            {[0, 1].map((i) => (
              <label className={`eye-field ${EyeFieldStyles}`} key={i}>
                Corner {i + 1} · x
                <input
                  type="number"
                  value={settings.corners?.[i][0] ?? (i === 0 ? 180 : 460)}
                  onChange={(e) => {
                    const corners: [Point, Point] = settings.corners
                      ? [[...settings.corners[0]], [...settings.corners[1]]]
                      : [
                          [180, 240],
                          [460, 240],
                        ]
                    corners[i][0] = Number(e.target.value)
                    update({ corners })
                  }}
                />
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={`eye-guidance-row ${EyeGuidanceRowStyles}`}>
            <p className={`eye-muted ${EyeMutedStyles}`} role="status">
              {modelHeading}
            </p>
            <HelpTip label="Eye model readiness help" text={modelGuidance} />
          </div>
          <div
            className={`eye-progress-track ${EyeProgressTrackStyles}`}
            role="progressbar"
            aria-label="Eye model readiness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={lockStatus.progress}
          >
            <i style={{ width: `${lockStatus.progress}%` }} />
          </div>
        </>
      )}
      <div
        className={`eye-action-row ${EyeActionRowStyles}`}
        role="group"
        aria-label="Eye model actions"
      >
        {settings.format === "classic" && (
          <EyeActionButton
            label="Reset corners to the eye region"
            onClick={resetCorners}
          >
            <ScanEye size={17} aria-hidden="true" />
          </EyeActionButton>
        )}
        <EyeActionButton
          label="Rebuild model"
          onClick={() => {
            update({ locked: false })
            setNotice("Look around to rebuild.")
          }}
        >
          <RotateCcw size={17} aria-hidden="true" />
        </EyeActionButton>
      </div>
      {settings.format === "spatial" && (
        <details className={`eye-details ${EyeDetailsStyles}`}>
          <summary>
            Camera geometry
            <ChevronDown size={14} />
          </summary>
          <label className={`eye-field ${EyeFieldStyles}`}>
            Field of view · °
            <input
              type="number"
              min="10"
              max="140"
              value={settings.fov}
              onChange={(e) => {
                const fov = Number(e.target.value)
                if (fov >= 10 && fov <= 140) {
                  update({ fov })
                }
              }}
            />
          </label>
          <label className={`eye-field ${EyeFieldStyles}`}>
            Eye radius · mm
            <input
              type="number"
              min="8"
              max="16"
              step="0.1"
              value={settings.radiusMm}
              onChange={(e) => {
                const radiusMm = Number(e.target.value)
                if (radiusMm >= 8 && radiusMm <= 16) {
                  update({ radiusMm })
                }
              }}
            />
          </label>
          <HelpTip
            label="Camera geometry help"
            text="45° and 12 mm are assumptions. Use the measured camera field of view for a better scale estimate."
          />
        </details>
      )}
    </>
  )
}
