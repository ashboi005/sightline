import { GazeCorrectionLayer } from "../gaze-correction/gaze-correction-layer"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  getGazeBubbleMaxDiameter,
  getGazeEdgeIndicator,
  getGazeView,
} from "./gaze-bubble"
import type {
  GazeBubbleOverlayProps,
  GazeBubbleOverlaySnapshot,
} from "./gaze-bubble-overlay.types"
import type { GazeView } from "./gaze-bubble.types"
import { useGazeBubble } from "./use-gaze-bubble"

const OUTSIDE_STATUS = "Gaze estimate outside screen"
const LIMITED_STATUS =
  "Calibration error is larger than the bubble · Recalibrate"
const CURSOR_RADIUS_PX = 5

function limitedStatus(showUncertainty: boolean): string {
  return showUncertainty
    ? LIMITED_STATUS
    : "Accuracy limited · Check calibration"
}

export function drawGazeBubbleOverlay(
  context: CanvasRenderingContext2D,
  snapshot: GazeBubbleOverlaySnapshot,
  width: number,
  height: number
) {
  const { bubble, view } = snapshot
  const showUncertainty = snapshot.showUncertainty !== false
  if (view.width <= 0 || view.height <= 0) {
    return
  }
  const scale = width / view.width
  const indicator = getGazeEdgeIndicator(bubble, view.width, view.height)
  if (indicator) {
    context.save()
    context.translate(indicator.left * scale, indicator.top * scale)
    context.rotate((indicator.angle * Math.PI) / 180)
    context.beginPath()
    context.moveTo(-4 * scale, -5 * scale)
    context.lineTo(2 * scale, 0)
    context.lineTo(-4 * scale, 5 * scale)
    context.strokeStyle = "#ff4d57"
    context.lineWidth = 2 * scale
    context.stroke()
    context.restore()
    context.save()
    context.fillStyle = "#ff7580"
    context.font = `${11 * scale}px sans-serif`
    context.textAlign = "center"
    context.fillText(OUTSIDE_STATUS, width / 2, height - 16 * scale)
    if (bubble.limited) {
      context.fillText(
        limitedStatus(showUncertainty),
        width / 2,
        height - 32 * scale,
        Math.max(1, width - 24 * scale)
      )
    }
    context.restore()
    return
  }
  const radius = (showUncertainty ? bubble.radiusPx : CURSOR_RADIUS_PX) * scale
  const x = bubble.center[0] * width
  const y = bubble.center[1] * height
  const rawX = bubble.rawPoint[0] * width
  const rawY = bubble.rawPoint[1] * height
  context.save()
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fillStyle = showUncertainty ? "rgba(255,77,87,0.05)" : "#ff4d57"
  context.fill()
  context.strokeStyle = "#ff4d57"
  context.lineWidth = Math.min(2, radius / 3)
  context.stroke()
  if (showUncertainty) {
    context.beginPath()
    context.arc(
      x,
      y,
      Math.min(CURSOR_RADIUS_PX * scale, radius),
      0,
      Math.PI * 2
    )
    context.fillStyle = "#ff4d57"
    context.fill()
  }
  if (
    showUncertainty &&
    Math.hypot(rawX - x, rawY - y) + 1.5 * scale <= radius
  ) {
    context.beginPath()
    context.arc(rawX, rawY, 1.5 * scale, 0, Math.PI * 2)
    context.fillStyle = "rgba(255,117,128,0.6)"
    context.fill()
  }
  context.restore()
}

export function GazeBubbleOverlay({
  point,
  timestamp,
  errorRadiusPx = null,
  showUncertainty = true,
  verified = false,
  resetKey,
  offset,
  fixed = true,
  stabilize = true,
  profile,
  imageSize,
  markerClassName = "",
  maxAgeMs,
  snapshotRef,
  correction,
}: GazeBubbleOverlayProps) {
  const container = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<GazeView | null>(null)
  const imageWidth = imageSize?.width
  const imageHeight = imageSize?.height
  useEffect(() => {
    const element = container.current
    if (!element) {
      return
    }
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      const width = fixed ? window.innerWidth : bounds.width
      const height = fixed ? window.innerHeight : bounds.height
      const image =
        imageWidth !== undefined && imageHeight !== undefined
          ? { width: imageWidth, height: imageHeight }
          : undefined
      const next = getGazeView(width, height, image)
      setView((previous) => {
        if (
          previous?.width === next?.width &&
          previous?.height === next?.height &&
          previous?.left === next?.left &&
          previous?.top === next?.top &&
          previous?.scale === next?.scale
        ) {
          return previous
        }
        return next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [fixed, imageWidth, imageHeight])
  const bubble = useGazeBubble({
    point,
    timestamp,
    view,
    errorRadiusPx,
    verified,
    stabilize,
    profile,
    resetKey,
    offset,
    maxAgeMs,
  })
  useLayoutEffect(() => {
    if (!snapshotRef) {
      return
    }
    snapshotRef.current =
      bubble && view ? { bubble, view, showUncertainty } : null
    return () => {
      snapshotRef.current = null
    }
  }, [bubble, view, snapshotRef, showUncertainty])
  const maxDiameter = view
    ? getGazeBubbleMaxDiameter(view.width, view.height)
    : 0
  let status = ""
  if (bubble?.limited) {
    status = limitedStatus(showUncertainty)
  } else if (bubble && !bubble.verified) {
    status = "Accuracy not checked"
  }
  const indicator =
    bubble && view
      ? getGazeEdgeIndicator(bubble, view.width, view.height)
      : null
  if (indicator) {
    status = [OUTSIDE_STATUS, status].filter(Boolean).join(" · ")
  }
  const rawX =
    bubble && view ? (bubble.rawPoint[0] - bubble.center[0]) * view.width : 0
  const rawY =
    bubble && view ? (bubble.rawPoint[1] - bubble.center[1]) * view.height : 0
  const rawInside =
    showUncertainty && bubble && Math.hypot(rawX, rawY) + 1.5 <= bubble.radiusPx
  const radius = showUncertainty ? (bubble?.radiusPx ?? 0) : CURSOR_RADIUS_PX
  return (
    <div
      ref={container}
      className="gaze-bubble-overlay"
      style={{
        position: fixed ? "fixed" : "absolute",
        inset: 0,
        zIndex: fixed ? 95 : 1,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {view && bubble && (
        <div
          className="gaze-bubble-view"
          style={{
            position: "absolute",
            left: view.left,
            top: view.top,
            width: view.width,
            height: view.height,
            overflow: "hidden",
          }}
        >
          {!indicator && (
            <div
              className={`gaze-bubble motion-safe:transition-[left,top,width,height] motion-safe:ease-out ${stabilize ? "motion-safe:duration-100" : "motion-safe:duration-50"} ${markerClassName}`}
              aria-hidden="true"
              data-limited={bubble.limited}
              data-motion={bubble.motion}
              style={{
                position: "absolute",
                left: `${bubble.center[0] * 100}%`,
                top: `${bubble.center[1] * 100}%`,
                width: radius * 2,
                height: radius * 2,
                // Enforce the cap even while a size transition is in progress.
                maxWidth: showUncertainty ? maxDiameter : CURSOR_RADIUS_PX * 2,
                maxHeight: showUncertainty ? maxDiameter : CURSOR_RADIUS_PX * 2,
                boxSizing: "border-box",
                borderRadius: "50%",
                border: `${Math.min(2, radius / 3)}px solid #ff4d57`,
                background: showUncertainty
                  ? "rgba(255,77,87,0.05)"
                  : "#ff4d57",
                boxShadow: "none",
                overflow: "hidden",
                transform: "translate(-50%, -50%)",
              }}
            >
              {showUncertainty && (
                <span className="gaze-center-cursor absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff4d57]" />
              )}
              {rawInside && (
                <i
                  style={{
                    position: "absolute",
                    left: `calc(50% + ${rawX}px)`,
                    top: `calc(50% + ${rawY}px)`,
                    width: 3,
                    height: 3,
                    borderRadius: "50%",
                    transform: "translate(-50%, -50%)",
                    background: "#ff7580",
                    opacity: 0.6,
                  }}
                />
              )}
            </div>
          )}
          {indicator && (
            <svg
              className="gaze-edge-indicator"
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              style={{
                position: "absolute",
                left: indicator.left,
                top: indicator.top,
                width: 16,
                height: 16,
                transform: `translate(-50%, -50%) rotate(${indicator.angle}deg)`,
                color: "#ff4d57",
              }}
            >
              <path
                d="M4 3 10 8 4 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          )}
          {status && (
            <span
              className="gaze-bubble-status"
              role="status"
              style={{
                position: "absolute",
                left: 12,
                right: 12,
                bottom: fixed ? 16 : 40,
                textAlign: "center",
                color: indicator ? "#ff7580" : "#e9b65e",
                fontSize: 11,
                lineHeight: 1.4,
                textShadow: "0 1px 3px #000",
              }}
            >
              {status}
            </span>
          )}
        </div>
      )}
      {correction && (
        <GazeCorrectionLayer
          point={point}
          timestamp={timestamp}
          offset={offset ?? [0, 0]}
          resetKey={resetKey}
          imageSize={imageSize}
          options={correction}
        />
      )}
    </div>
  )
}
