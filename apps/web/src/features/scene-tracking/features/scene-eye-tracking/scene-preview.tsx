import { Camera, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { GazeBubbleOverlay } from "../gaze-bubble/gaze-bubble-overlay"
import { NETWORK_CONNECTION_LABELS } from "../eye-tracking/network-camera"
import {
  SceneEmptyStyles,
  ScenePreviewCaptionStyles,
  ScenePreviewStyles,
  SceneRecoveryStyles,
} from "../tracking-ui/scene-styles"
import { MAX_HAND_RECOVERY_MS } from "./calibration"
import type { ScenePreviewProps } from "./scene-preview.types"
import type { GazeMeasurement } from "./scene.types"
const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
]
export function ScenePreview({
  camera,
  frame,
  hand,
  handRecovering = false,
  marker = null,
  hideMarkerPattern = false,
  method = "hand",
  gaze,
  gazeDisplay,
  trace,
  holds,
  capturing,
  target,
  progress,
  connection,
  canvasRef,
  gazeSnapshotRef,
}: ScenePreviewProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const attachCanvas = useCallback(
    (element: HTMLCanvasElement | null) => {
      canvas.current = element
      if (canvasRef) {
        canvasRef.current = element
      }
    },
    [canvasRef]
  )
  useEffect(() => {
    const element = canvas.current
    const raw = camera.rawCanvas
    if (!element || !frame) {
      return
    }
    if (element.width !== frame.width) {
      element.width = frame.width
    }
    if (element.height !== frame.height) {
      element.height = frame.height
    }
    const ctx = element.getContext("2d")
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, element.width, element.height)
    ctx.drawImage(raw, 0, 0)
    const w = element.width
    const h = element.height
    const scale = Math.max(1, w / 640)
    if (
      hideMarkerPattern &&
      marker?.position &&
      marker.corners.length &&
      marker.scene.generation === frame.generation &&
      performance.now() - marker.scene.timestamp <= 250
    ) {
      // A same-screen preview must not become another optical calibration
      // target. Mask the display copy while the detector keeps using rawCanvas.
      const xs = marker.corners.map(([x]) => x * w)
      const ys = marker.corners.map(([, y]) => y * h)
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const width = Math.max(...xs) - left
      const height = Math.max(...ys) - top
      ctx.fillStyle = "#19231f"
      ctx.fillRect(
        left - width * 0.1,
        top - height * 0.1,
        width * 1.2,
        height * 1.2
      )
    }
    if (capturing) {
      for (const hold of holds) {
        ctx.fillStyle = "#83d7b2"
        ctx.beginPath()
        ctx.arc(
          hold.target[0] * w,
          hold.target[1] * h,
          4 * scale,
          0,
          Math.PI * 2
        )
        ctx.fill()
      }
      if (target) {
        const radius = Math.min(w, h) * 0.1
        ctx.lineWidth = 2 * scale
        ctx.strokeStyle = "rgba(255,255,255,.6)"
        ctx.setLineDash([6 * scale, 5 * scale])
        ctx.beginPath()
        ctx.arc(target[0] * w, target[1] * h, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.strokeStyle = "#83d7b2"
        ctx.lineWidth = 4 * scale
        ctx.beginPath()
        ctx.arc(
          target[0] * w,
          target[1] * h,
          radius,
          -Math.PI / 2,
          -Math.PI / 2 + progress * Math.PI * 2
        )
        ctx.stroke()
      }
    }
    if (
      hand &&
      connection === "live" &&
      hand.scene.generation === frame.generation &&
      performance.now() - hand.scene.timestamp <= MAX_HAND_RECOVERY_MS
    ) {
      ctx.globalAlpha = handRecovering ? 0.45 : 1
      for (const landmarks of hand.landmarks) {
        ctx.lineWidth = 2 * scale
        ctx.strokeStyle = "#7dd3fc"
        for (const [a, b] of CONNECTIONS) {
          const p = landmarks[a]
          const q = landmarks[b]
          if (!p || !q) {
            continue
          }
          ctx.beginPath()
          ctx.moveTo(p.x * w, p.y * h)
          ctx.lineTo(q.x * w, q.y * h)
          ctx.stroke()
        }
        for (let i = 0; i < landmarks.length; i++) {
          const p = landmarks[i]
          ctx.beginPath()
          ctx.arc(p.x * w, p.y * h, (i === 8 ? 8 : 3) * scale, 0, Math.PI * 2)
          ctx.fillStyle = i === 8 ? "#fbbf24" : "#d9f4ff"
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
    if (
      marker?.position &&
      marker.scene.generation === frame.generation &&
      performance.now() - marker.scene.timestamp <= 250
    ) {
      ctx.strokeStyle = "#83d7b2"
      ctx.lineWidth = 2 * scale
      ctx.beginPath()
      marker.corners.forEach(([x, y], index) =>
        index ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)
      )
      ctx.closePath()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(
        marker.position[0] * w,
        marker.position[1] * h,
        6 * scale,
        0,
        Math.PI * 2
      )
      ctx.stroke()
    }
    ctx.strokeStyle = "rgba(244,114,182,.7)"
    ctx.lineWidth = 2 * scale
    let previous: GazeMeasurement | null = null
    for (const point of capturing ? [] : trace) {
      if (!point.valid || !point.position) {
        previous = null
        continue
      }
      if (previous?.position && point.timestamp - previous.timestamp <= 250) {
        ctx.beginPath()
        ctx.moveTo(previous.position[0] * w, previous.position[1] * h)
        ctx.lineTo(point.position[0] * w, point.position[1] * h)
        ctx.stroke()
      }
      previous = point
    }
  }, [
    camera,
    canvas,
    connection,
    frame,
    hand,
    handRecovering,
    marker,
    hideMarkerPattern,
    method,
    trace,
    holds,
    capturing,
    target,
    progress,
  ])
  return (
    <div
      className={`scene-preview ${ScenePreviewStyles} ${frame ? "has-scene" : ""}`}
    >
      <canvas
        ref={attachCanvas}
        aria-label={
          method === "marker"
            ? "Scene camera preview with calibration marker and mapped gaze"
            : "Scene camera preview with hand landmarks and mapped gaze"
        }
        hidden={!frame}
      />
      {frame && (
        <GazeBubbleOverlay
          {...gazeDisplay}
          snapshotRef={gazeSnapshotRef}
          point={
            !capturing && connection === "live"
              ? (gaze?.position ?? null)
              : null
          }
          timestamp={gaze?.eyeTimestamp ?? null}
          imageSize={frame}
          fixed={false}
          stabilize={false}
        />
      )}
      {!frame && (
        <div className={`scene-empty ${SceneEmptyStyles}`}>
          <Camera size={32} strokeWidth={1.25} aria-hidden="true" />
          <p>No camera connected</p>
        </div>
      )}
      {(connection === "waiting" ||
        connection === "reconnecting" ||
        connection === "connecting") && (
        <div
          className={`scene-recovery ${SceneRecoveryStyles}`}
          role="status"
          aria-live="polite"
        >
          <LoaderCircle size={18} aria-hidden="true" />
          <span>{NETWORK_CONNECTION_LABELS[connection]}</span>
        </div>
      )}
      <div className={`scene-preview-caption ${ScenePreviewCaptionStyles}`}>
        <span>
          {camera.getSnapshot().transform.rotation}°
          {camera.getSnapshot().transform.mirrorX ? " · Mirrored" : ""}
          {camera.getSnapshot().transform.mirrorY ? " · Flipped" : ""}
          {!capturing && gaze?.preview ? " · Unverified preview" : ""}
          {!capturing && gaze?.estimated ? " · Accuracy not checked" : ""}
        </span>
        {frame && (
          <span>
            {frame.width} × {frame.height}
          </span>
        )}
      </div>
    </div>
  )
}
