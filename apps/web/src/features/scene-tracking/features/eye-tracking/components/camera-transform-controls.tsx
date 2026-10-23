import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Undo2,
} from "lucide-react"
import {
  CameraAngleStyles,
  CameraTransformControlsStyles,
} from "../../tracking-ui/camera-styles"
import {
  DEFAULT_CAMERA_TRANSFORM,
  normalizeCameraTransform,
  type CameraTransform,
} from "../camera-transform"
import type { CameraTransformControlsProps } from "./camera-transform-controls.types"
export function CameraTransformControls({
  value,
  onChange: onTransformChange,
  label,
  disabled = false,
}: CameraTransformControlsProps) {
  function onChange(next: CameraTransform) {
    const normalized = normalizeCameraTransform(next)
    if (
      normalized.rotation !== value.rotation ||
      normalized.mirrorX !== value.mirrorX ||
      normalized.mirrorY !== value.mirrorY
    ) {
      onTransformChange(normalized)
    }
  }
  return (
    <div
      className={`camera-transform-controls ${CameraTransformControlsStyles}`}
      role="group"
      aria-label={label + " orientation"}
    >
      <button
        type="button"
        title="Rotate counterclockwise 90°"
        data-tooltip="Rotate counterclockwise 90°"
        aria-label={label + " rotate counterclockwise"}
        disabled={disabled}
        onClick={() => onChange({ ...value, rotation: value.rotation - 90 })}
      >
        <RotateCcw size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Rotate clockwise 90°"
        data-tooltip="Rotate clockwise 90°"
        aria-label={label + " rotate clockwise"}
        disabled={disabled}
        onClick={() => onChange({ ...value, rotation: value.rotation + 90 })}
      >
        <RotateCw size={16} aria-hidden="true" />
      </button>
      <label
        className={`camera-angle ${CameraAngleStyles}`}
        title="Clockwise rotation in degrees"
        data-tooltip="Rotation angle · degrees"
      >
        <input
          type="number"
          aria-label={label + " rotation angle"}
          min={0}
          max={359}
          step={1}
          value={Math.round(value.rotation * 100) / 100}
          disabled={disabled}
          onChange={(event) => {
            if (
              event.target.value !== "" &&
              Number.isFinite(event.target.valueAsNumber)
            ) {
              onChange({ ...value, rotation: event.target.valueAsNumber })
            }
          }}
        />
        <span aria-hidden="true">°</span>
      </label>
      <button
        type="button"
        title="Mirror horizontally"
        data-tooltip="Mirror horizontally"
        aria-label={label + " mirror horizontally"}
        aria-pressed={value.mirrorX}
        disabled={disabled}
        onClick={() => onChange({ ...value, mirrorX: !value.mirrorX })}
      >
        <FlipHorizontal2 size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Flip vertically"
        data-tooltip="Flip vertically"
        aria-label={label + " flip vertically"}
        aria-pressed={value.mirrorY}
        disabled={disabled}
        onClick={() => onChange({ ...value, mirrorY: !value.mirrorY })}
      >
        <FlipVertical2 size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Reset orientation"
        data-tooltip="Reset orientation"
        aria-label={label + " reset orientation"}
        disabled={disabled}
        onClick={() => onChange({ ...DEFAULT_CAMERA_TRANSFORM })}
      >
        <Undo2 size={15} aria-hidden="true" />
      </button>
    </div>
  )
}
