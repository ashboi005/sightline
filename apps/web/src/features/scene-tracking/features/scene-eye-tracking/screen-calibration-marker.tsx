import { Minus, Plus } from "lucide-react"
import { useState, type CSSProperties } from "react"
import {
  EyeActionIconStyles,
  EyeButtonStyles,
} from "../tracking-ui/control-styles"
import {
  ScreenCalibrationMarkerStyles,
  ScreenMarkerSizeStyles,
  ScreenMarkerStageStyles,
} from "../tracking-ui/scene-styles"
import { markerSvg } from "./marker-detector"
import type { ScreenCalibrationMarkerProps } from "./screen-calibration-marker.types"
const markerUrl = "data:image/svg+xml," + encodeURIComponent(markerSvg())
export function ScreenCalibrationMarker({
  capturing,
}: ScreenCalibrationMarkerProps) {
  const [size, setSize] = useState(100)
  return (
    <div
      className={`screen-marker-stage ${ScreenMarkerStageStyles}`}
      aria-label="On-screen calibration marker"
    >
      <img
        className={`screen-calibration-marker ${ScreenCalibrationMarkerStyles}`}
        src={markerUrl}
        alt="Calibration marker. Look at the red center."
        style={{ "--marker-scale": size / 100 } as CSSProperties}
        draggable={false}
      />
      <div
        className={`screen-marker-size ${ScreenMarkerSizeStyles}`}
        role="group"
        aria-label="Marker size"
      >
        <button
          type="button"
          className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
          aria-label="Smaller marker"
          title="Smaller marker"
          data-tooltip="Smaller marker"
          disabled={capturing || size <= 60}
          onClick={() => setSize((value) => value - 10)}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
          aria-label="Larger marker"
          title="Larger marker · easier detection"
          data-tooltip="Larger marker · easier detection"
          disabled={capturing || size >= 100}
          onClick={() => setSize((value) => value + 10)}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
