import { CircleDot, Hand, Pointer } from "lucide-react"
import {
  EyeButtonStyles,
  EyeSourceTypeStyles,
} from "../tracking-ui/control-styles"
import { SceneCalibrationMethodsStyles } from "../tracking-ui/scene-styles"
import type { CalibrationMethodControlsProps } from "./calibration-method-controls.types"
import { rememberCalibrationMethod } from "./calibration-preferences"
const METHODS = [
  {
    value: "hand",
    label: "Hand",
    icon: Hand,
    help: "Nine fingertip positions and five fresh accuracy checks. Space locks each point.",
  },
  {
    value: "marker",
    label: "Marker",
    icon: CircleDot,
    help: "Look at the red center on this page. Move your head and pause; positions are captured automatically.",
  },
  {
    value: "one-point",
    label: "One point",
    icon: Pointer,
    help: "Look at your fingertip and press Space once. Experimental estimate; accuracy is not independently measured.",
  },
] as const
export function CalibrationMethodControls({
  value,
  disabled,
  onChange,
}: CalibrationMethodControlsProps) {
  return (
    <div
      className={`scene-calibration-methods ${SceneCalibrationMethodsStyles} eye-source-type ${EyeSourceTypeStyles}`}
      role="radiogroup"
      aria-label="Calibration method"
    >
      {METHODS.map(({ value: method, label, icon: Icon, help }) => (
        <button
          key={method}
          type="button"
          className={`eye-button ${EyeButtonStyles} secondary`}
          role="radio"
          data-calibration-shortcut
          aria-checked={value === method}
          aria-label={`${label} calibration`}
          title={help}
          data-tooltip={help}
          disabled={disabled}
          onClick={() => {
            onChange(method)
            rememberCalibrationMethod(method)
          }}
        >
          <Icon size={17} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
