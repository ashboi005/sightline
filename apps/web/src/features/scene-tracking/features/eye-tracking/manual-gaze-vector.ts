import type { Point, Vector3 } from "./eye-tracking.types"

/** Map the pupil against the manually placed eye sphere; retain its positive-z convention. */
export function gazeVector3D(
  pupil: Point,
  center: [number, number],
  radius: number
): Vector3 {
  if (radius <= 1e-6) {
    return [0, 0, 1]
  }
  let nx = (pupil[0] - center[0]) / radius
  let ny = (pupil[1] - center[1]) / radius
  const radial = Math.hypot(nx, ny)
  if (radial >= 0.999) {
    const scale = 0.999 / Math.max(radial, 1e-6)
    nx *= scale
    ny *= scale
  }
  const nz = Math.sqrt(Math.max(1e-6, 1 - nx * nx - ny * ny))
  const length = Math.hypot(nx, ny, nz)
  if (!Number.isFinite(length) || length <= 1e-8) {
    return [0, 0, 1]
  }
  return [nx / length, ny / length, nz / length]
}
