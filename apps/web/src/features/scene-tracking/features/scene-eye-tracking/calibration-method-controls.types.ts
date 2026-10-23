import type { CalibrationMethod } from "./scene.types"

export type CalibrationMethodControlsProps = {
  value: CalibrationMethod
  disabled?: boolean
  onChange: (value: CalibrationMethod) => void
}
