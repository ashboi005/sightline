import type { CameraTransform } from "../camera-transform"

export type CameraTransformControlsProps = {
  value: CameraTransform
  onChange: (value: CameraTransform) => void
  label: string
  disabled?: boolean
}
