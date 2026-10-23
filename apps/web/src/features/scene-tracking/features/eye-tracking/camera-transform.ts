import type { CameraTransform, FrameDimensions } from "./camera-transform.types"
export type { CameraTransform } from "./camera-transform.types"
export const DEFAULT_CAMERA_TRANSFORM: CameraTransform = {
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
}
export function normalizeCameraTransform(
  value: CameraTransform
): CameraTransform {
  return {
    rotation: Number.isFinite(value.rotation)
      ? ((value.rotation % 360) + 360) % 360
      : 0,
    mirrorX: !!value.mirrorX,
    mirrorY: !!value.mirrorY,
  }
}
export function cameraFrameGeometry(
  width: number,
  height: number,
  value: CameraTransform,
  output?: FrameDimensions
) {
  const transform = normalizeCameraTransform(value)
  const [ra, rb, rc, rd] = cameraDirectionMatrix(transform)
  const rotatedWidth = Math.ceil(Math.abs(width * ra) + Math.abs(height * rc))
  const rotatedHeight = Math.ceil(Math.abs(width * rb) + Math.abs(height * rd))
  const size = output ?? { width: rotatedWidth, height: rotatedHeight }
  const sx = size.width / rotatedWidth
  const sy = size.height / rotatedHeight
  const a = sx * ra
  const b = sy * rb
  const c = sx * rc
  const d = sy * rd
  return {
    ...size,
    matrix: [
      a,
      b,
      c,
      d,
      size.width / 2 - (a * width) / 2 - (c * height) / 2,
      size.height / 2 - (b * width) / 2 - (d * height) / 2,
    ] as [number, number, number, number, number, number],
  }
}
/** Linear image axes: clockwise rotation, then mirroring in the displayed axes. */
export function cameraDirectionMatrix(value: CameraTransform) {
  const transform = normalizeCameraTransform(value)
  const angle = (transform.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(angle)) < 1e-10 ? 0 : Math.cos(angle)
  const sin = Math.abs(Math.sin(angle)) < 1e-10 ? 0 : Math.sin(angle)
  const mx = transform.mirrorX ? -1 : 1
  const my = transform.mirrorY ? -1 : 1
  return [mx * cos, my * sin, -mx * sin, my * cos] as const
}
export function isDefaultCameraTransform(value: CameraTransform): boolean {
  return value.rotation === 0 && !value.mirrorX && !value.mirrorY
}
export function drawCameraFrame(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  transform: CameraTransform,
  output = { width: ctx.canvas.width, height: ctx.canvas.height }
) {
  if (isDefaultCameraTransform(transform)) {
    ctx.drawImage(image, 0, 0, output.width, output.height)
    return
  }
  const geometry = cameraFrameGeometry(width, height, transform, output)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, output.width, output.height)
  ctx.setTransform(...geometry.matrix)
  ctx.drawImage(image, 0, 0, width, height)
  ctx.restore()
}
export function readCameraTransform(role: "eye" | "scene" | "esp"): CameraTransform {
  try {
    const value = JSON.parse(
      localStorage.getItem(`sightline.${role}-camera.transform.v1`) ?? "null"
    )
    if (
      value &&
      typeof value.rotation === "number" &&
      typeof value.mirrorX === "boolean" &&
      typeof value.mirrorY === "boolean"
    ) {
      return normalizeCameraTransform(value)
    }
  } catch {
    /* Orientation settings are optional when storage is unavailable. */
  }
  return { ...DEFAULT_CAMERA_TRANSFORM }
}
export function saveCameraTransform(
  role: "eye" | "scene" | "esp",
  value: CameraTransform
): void {
  try {
    localStorage.setItem(
      `sightline.${role}-camera.transform.v1`,
      JSON.stringify(value)
    )
  } catch {
    /* The camera remains usable without storage. */
  }
}
