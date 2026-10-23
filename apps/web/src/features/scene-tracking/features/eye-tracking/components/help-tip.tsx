import { Info } from "lucide-react"
import { useId, useState } from "react"
import {
  EyeHelpTipStyles,
  EyeIconButtonStyles,
  EyeSrOnlyStyles,
} from "../../tracking-ui/control-styles"
import { EyeTooltip } from "./eye-tooltip"
import type { HelpTipProps } from "./help-tip.types"
export function HelpTip({ text, label = "Help" }: HelpTipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const visible = !dismissed && (open || hovered || focused)
  return (
    <span
      className={`eye-help-tip ${EyeHelpTipStyles}`}
      data-open={visible || undefined}
      data-dismissed={dismissed || undefined}
      onMouseEnter={() => {
        setDismissed(false)
        setHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        ref={setButton}
        className={`eye-icon-button ${EyeIconButtonStyles}`}
        aria-label={label}
        aria-describedby={id}
        aria-expanded={visible}
        onClick={() => {
          setDismissed(open)
          setOpen(!open)
        }}
        onFocus={() => {
          setDismissed(false)
          setFocused(true)
        }}
        onBlur={() => {
          setOpen(false)
          setFocused(false)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
            setOpen(false)
            setDismissed(true)
          }
        }}
      >
        <Info size={15} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" className={`eye-sr-only ${EyeSrOnlyStyles}`}>
        {text}
      </span>
      {visible && button && <EyeTooltip anchor={button} text={text} />}
    </span>
  )
}
