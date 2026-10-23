import type { Point } from "./eye-tracking.types"
/** Clearly labeled synthetic input, processed by the same detector as camera frames. */
export function drawSample(
  ctx: CanvasRenderingContext2D,
  time: number,
  target: Point | null,
  blink: boolean
) {
  const w = 640
  const h = 480
  const cx = 320
  const cy = 240
  ctx.fillStyle = "#989a99"
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = "#cfd1cd"
  ctx.beginPath()
  ctx.ellipse(cx, cy, 230, 145, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = "#626765"
  ctx.lineWidth = 9
  ctx.stroke()
  const dx = target ? (target[0] - 0.5) * 150 : 83 * Math.sin(time * 0.0012)
  const dy = target
    ? (target[1] - 0.5) * 130
    : 65 * Math.sin(time * 0.0017 + 0.8)
  const angle = Math.atan2(dy, dx) + Math.PI / 2
  const ratio = Math.sqrt(Math.max(0.2, 1 - (dx * dx + dy * dy) / 135 ** 2))
  ctx.fillStyle = "#616760"
  ctx.beginPath()
  ctx.ellipse(cx + dx, cy + dy, 70, 70 * ratio, angle, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#151817"
  ctx.beginPath()
  ctx.ellipse(cx + dx, cy + dy, 38, 38 * ratio, angle, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#f9f9f7"
  ctx.beginPath()
  ctx.arc(cx + dx - 8, cy + dy - 7, 3, 0, Math.PI * 2)
  ctx.fill()
  if (blink) {
    ctx.fillStyle = "#989a99"
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = "#575b59"
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(110, 240)
    ctx.quadraticCurveTo(320, 270, 530, 240)
    ctx.stroke()
  }
}
