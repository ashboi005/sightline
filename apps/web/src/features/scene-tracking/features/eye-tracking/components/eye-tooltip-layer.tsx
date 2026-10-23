import { useEffect, useState } from "react"
import { EyeTooltip } from "./eye-tooltip"
/** One tooltip layer serves the existing icon buttons without changing their layout. */
export function EyeTooltipLayer() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useEffect(() => {
    function show(event: Event): void {
      if (!(event.target instanceof Element)) {
        return
      }
      const trigger = event.target.closest<HTMLElement>(
        ".eye-app [data-tooltip]"
      )
      setAnchor(trigger)
    }
    function hide(event: Event): void {
      if (event instanceof KeyboardEvent && event.key !== "Escape") {
        return
      }
      setAnchor(null)
    }
    function leave(event: MouseEvent): void {
      if (!(event.target instanceof Element)) {
        return
      }
      const trigger = event.target.closest<HTMLElement>("[data-tooltip]")
      if (
        event.relatedTarget instanceof Node &&
        trigger?.contains(event.relatedTarget)
      ) {
        return
      }
      setAnchor(null)
    }
    document.addEventListener("mouseover", show)
    document.addEventListener("mouseout", leave)
    document.addEventListener("focusin", show)
    document.addEventListener("focusout", hide)
    document.addEventListener("keydown", hide)
    document.addEventListener("click", hide)
    return () => {
      document.removeEventListener("mouseover", show)
      document.removeEventListener("mouseout", leave)
      document.removeEventListener("focusin", show)
      document.removeEventListener("focusout", hide)
      document.removeEventListener("keydown", hide)
      document.removeEventListener("click", hide)
    }
  }, [])
  useEffect(() => {
    if (!anchor) {
      return
    }
    // Keep native title as a fallback, but avoid showing a second tooltip while ours is open.
    const title = anchor.getAttribute("title")
    anchor.removeAttribute("title")
    return () => {
      if (title !== null) {
        anchor.setAttribute("title", title)
      }
    }
  }, [anchor])
  const text = anchor?.dataset.tooltip
  if (!anchor?.isConnected || !text) {
    return null
  }
  return <EyeTooltip anchor={anchor} text={text} />
}
