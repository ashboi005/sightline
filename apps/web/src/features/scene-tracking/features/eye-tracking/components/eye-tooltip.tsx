import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { EyeFloatingTooltipStyles } from "../../tracking-ui/control-styles"
import type { EyeTooltipProps, TooltipPosition } from "./eye-tooltip.types"
const EDGE_GAP = 8
export function EyeTooltip({ anchor, text, id }: EyeTooltipProps) {
  const tooltip = useRef<HTMLSpanElement | null>(null)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  useLayoutEffect(() => {
    function placeTooltip(): void {
      const element = tooltip.current
      if (!element) {
        return
      }
      const trigger = anchor.getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      const maximumLeft = Math.max(
        EDGE_GAP,
        window.innerWidth - bounds.width - EDGE_GAP
      )
      const left = Math.max(
        EDGE_GAP,
        Math.min(
          maximumLeft,
          trigger.left + trigger.width / 2 - bounds.width / 2
        )
      )
      let top = trigger.top - bounds.height - EDGE_GAP
      if (top < EDGE_GAP) {
        top = trigger.bottom + EDGE_GAP
      }
      top = Math.max(
        EDGE_GAP,
        Math.min(top, window.innerHeight - bounds.height - EDGE_GAP)
      )
      setPosition({ left, top })
    }
    placeTooltip()
    window.addEventListener("resize", placeTooltip)
    window.addEventListener("scroll", placeTooltip, true)
    return () => {
      window.removeEventListener("resize", placeTooltip)
      window.removeEventListener("scroll", placeTooltip, true)
    }
  }, [anchor, text])
  return createPortal(
    <span
      ref={tooltip}
      id={id}
      role="tooltip"
      className={`eye-floating-tooltip ${EyeFloatingTooltipStyles}`}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {text}
    </span>,
    document.body
  )
}
