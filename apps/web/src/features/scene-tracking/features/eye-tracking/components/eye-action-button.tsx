import {
  EyeActionIconStyles,
  EyeButtonStyles,
} from "../../tracking-ui/control-styles"
import type { EyeActionButtonProps } from "./eye-action-button.types"
export function EyeActionButton({
  label,
  className = `eye-button ${EyeButtonStyles} secondary`,
  children,
  type = "button",
  ...props
}: EyeActionButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`${className} eye-action-icon ${EyeActionIconStyles}`}
      aria-label={label}
      title={label}
      data-tooltip={label}
    >
      {children}
    </button>
  )
}
