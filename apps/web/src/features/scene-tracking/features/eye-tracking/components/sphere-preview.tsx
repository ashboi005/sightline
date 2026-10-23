import { useEffect, useRef } from "react"
import {
  EyeSphereMetricsStyles,
  EyeSphereStyles,
} from "../../tracking-ui/camera-styles"
import type { SpherePreviewProps } from "./sphere-preview.types"
export function SpherePreview({ frame }: SpherePreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) {
      return
    }
    const colors = getComputedStyle(canvas)
    context.clearRect(0, 0, 280, 220)
    context.strokeStyle = colors.getPropertyValue("--line")
    context.lineWidth = 1
    context.beginPath()
    context.arc(140, 105, 74, 0, Math.PI * 2)
    context.stroke()
    for (const radius of [24, 50]) {
      context.beginPath()
      context.ellipse(140, 105, radius, 74, 0, 0, Math.PI * 2)
      context.stroke()
      context.beginPath()
      context.ellipse(140, 105, 74, radius, 0, 0, Math.PI * 2)
      context.stroke()
    }
    const gaze = frame?.gaze?.direction
    if (!gaze) {
      return
    }
    context.strokeStyle = colors.color
    context.lineWidth = 3
    context.beginPath()
    context.moveTo(140, 105)
    context.lineTo(140 + gaze[0] * 115, 105 + gaze[1] * 115)
    context.stroke()
    context.fillStyle = colors.color
    context.beginPath()
    context.arc(140 + gaze[0] * 74, 105 + gaze[1] * 74, 6, 0, Math.PI * 2)
    context.fill()
  }, [frame])
  const model = frame?.model
  return (
    <div className={`eye-sphere ${EyeSphereStyles}`}>
      <div className="eye-section-label">
        EYE MODEL <span>{model?.ready ? "Fitted" : "Collecting"}</span>
      </div>
      <canvas
        width={280}
        height={220}
        ref={ref}
        aria-label="Projected spherical eye model and gaze direction"
      />
      <div className={`eye-sphere-metrics ${EyeSphereMetricsStyles}`}>
        <span>
          {model?.samples ?? 0}
          <small>observations</small>
        </span>
        <span>
          {Math.round((model?.coverage ?? 0) * 100)}%<small>coverage</small>
        </span>
        <span>
          {model ? model.residual.toFixed(1) : "—"}
          <small>fit error · px</small>
        </span>
      </div>
    </div>
  )
}
