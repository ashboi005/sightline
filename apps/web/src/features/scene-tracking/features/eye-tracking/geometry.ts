import type {
  Ellipse,
  Gaze,
  Intrinsics,
  Point,
  Sphere,
  Vector3,
} from "./eye-tracking.types"
import type { EyeCenterFit, EyeRayLine } from "./geometry.types"
export const dot = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + v * b[i], 0)
export const finite = (values: number[]) => values.every(Number.isFinite)
export function normalize(v: Vector3): Vector3 | null {
  const length = Math.hypot(...v)
  return finite(v) && length > 1e-10
    ? (v.map((x) => x / length) as Vector3)
    : null
}
export function cameraIntrinsics(
  width: number,
  height: number,
  fovY: number
): Intrinsics | null {
  if (
    !finite([width, height, fovY]) ||
    width < 2 ||
    height < 2 ||
    fovY <= 5 ||
    fovY >= 150
  ) {
    return null
  }
  const f = height / (2 * Math.tan((fovY * Math.PI) / 360))
  return { fx: f, fy: f, cx: width / 2, cy: height / 2 }
}
export function pixelRay(p: Point, k: Intrinsics): Vector3 | null {
  if (!finite([...p, k.fx, k.fy, k.cx, k.cy]) || k.fx <= 0 || k.fy <= 0) {
    return null
  }
  return normalize([(p[0] - k.cx) / k.fx, (p[1] - k.cy) / k.fy, 1])
}
/** Nearest positive intersection. A missed ray is invalid, never a fabricated tangent. */
export function raySphereIntersection(
  origin: Vector3,
  direction: Vector3,
  center: Vector3,
  radius: number
): Vector3 | null {
  if (!finite([...origin, ...direction, ...center, radius]) || radius <= 0) {
    return null
  }
  const d = normalize(direction)
  if (!d) {
    return null
  }
  const oc = origin.map((v, i) => v - center[i])
  const halfB = dot(d, oc)
  const c = dot(oc, oc) - radius * radius
  const disc = halfB * halfB - c
  const tolerance = 1e-12 * Math.max(1, halfB * halfB, Math.abs(c))
  if (disc < -tolerance) {
    return null
  }
  const root = Math.sqrt(Math.max(0, disc))
  const near = -halfB - root
  const far = -halfB + root
  let t: number | null = null
  if (near > 1e-9) {
    t = near
  } else if (far > 1e-9) {
    t = far
  }
  return t === null ? null : (origin.map((v, i) => v + t * d[i]) as Vector3)
}
/** Approximate a projected sphere by its angular silhouette radius. Exact on axis.
 * Off-axis image circles are an approximation; calibrated intrinsics improve scale,
 * but this is not a refractive, perspective-correct reconstruction of the pupil. */
export function sphereFromProjection(
  center: Point,
  radiusPx: number,
  radiusMm: number,
  k: Intrinsics
): Sphere | null {
  const axis = pixelRay(center, k)
  if (
    !axis ||
    !finite([radiusPx, radiusMm]) ||
    radiusPx <= 1 ||
    radiusMm <= 0
  ) {
    return null
  }
  const angles: number[] = []
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const edge = pixelRay(
      [center[0] + dx * radiusPx, center[1] + dy * radiusPx],
      k
    )
    if (!edge) {
      return null
    }
    angles.push(Math.acos(Math.min(1, Math.max(-1, dot(axis, edge)))))
  }
  const angularRadius = angles.reduce((a, b) => a + b, 0) / angles.length
  const distance = radiusMm / Math.sin(angularRadius)
  if (!Number.isFinite(distance) || distance <= radiusMm) {
    return null
  }
  return { center: axis.map((v) => v * distance) as Vector3, radius: radiusMm }
}
export function gazeFromPupil(
  pupil: Point,
  sphere: Sphere,
  k: Intrinsics
): Gaze | null {
  const ray = pixelRay(pupil, k)
  const hit =
    ray && raySphereIntersection([0, 0, 0], ray, sphere.center, sphere.radius)
  const direction =
    hit && normalize(hit.map((v, i) => v - sphere.center[i]) as Vector3)
  return hit && direction
    ? { origin: sphere.center, direction, pupil: hit }
    : null
}
export function minorAxisLine(e: Ellipse): EyeRayLine | null {
  if (
    !finite([...e.center, e.major, e.minor, e.angle, e.confidence]) ||
    e.minor <= 0 ||
    e.major <= 0 ||
    e.minor / e.major > 0.97
  ) {
    return null
  }
  return { point: e.center, direction: [-Math.sin(e.angle), Math.cos(e.angle)] }
}
export function outerEdgeDistance(center: Point, e: Ellipse): number {
  const dx = e.center[0] - center[0]
  const dy = e.center[1] - center[1]
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-9) {
    return e.major
  }
  const ux = dx / distance
  const uy = dy / distance
  const c = Math.cos(e.angle)
  const s = Math.sin(e.angle)
  const edge =
    1 / Math.hypot((c * ux + s * uy) / e.major, (-s * ux + c * uy) / e.minor)
  return distance + edge
}
/** Deterministic consensus followed by weighted perpendicular-distance least squares. */
export function fitEyeCenter(
  ellipses: Ellipse[],
  width: number,
  height: number
): EyeCenterFit | null {
  const lines = ellipses
    .filter((e) => e.confidence >= 0.85)
    .map((e) => ({ e, line: minorAxisLine(e) }))
    .filter((item) => item.line !== null)
  if (lines.length < 8) {
    return null
  }
  const limit = Math.max(2, Math.min(width, height) * 0.018)
  const distance = (
    p: Point,
    l: NonNullable<ReturnType<typeof minorAxisLine>>
  ) =>
    Math.abs(
      (p[0] - l.point[0]) * l.direction[1] -
        (p[1] - l.point[1]) * l.direction[0]
    )
  let best: typeof lines = []
  let bestError = Infinity
  // Evenly sample candidate lines, score against ALL observations. No random jitter.
  const step = Math.max(1, Math.floor(lines.length / 20))
  for (let i = 0; i < lines.length; i += step) {
    for (let j = i + step; j < lines.length; j += step) {
      const a = lines[i].line!
      const b = lines[j].line!
      const det =
        a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0]
      if (Math.abs(det) < Math.sin((8 * Math.PI) / 180)) {
        continue
      }
      const dx = b.point[0] - a.point[0]
      const dy = b.point[1] - a.point[1]
      const t = (dx * b.direction[1] - dy * b.direction[0]) / det
      const p: Point = [
        a.point[0] + t * a.direction[0],
        a.point[1] + t * a.direction[1],
      ]
      if (p[0] < 0 || p[1] < 0 || p[0] >= width || p[1] >= height) {
        continue
      }
      const inliers = lines.filter((l) => distance(p, l.line!) <= limit)
      const error = inliers.reduce(
        (sum, l) => sum + distance(p, l.line!) ** 2,
        0
      )
      if (
        inliers.length > best.length ||
        (inliers.length === best.length && error < bestError)
      ) {
        best = inliers
        bestError = error
      }
    }
  }
  if (best.length < 8 || best.length < lines.length * 0.7) {
    return null
  }
  let a = 0
  let b = 0
  let c = 0
  let x = 0
  let y = 0
  for (const { e, line } of best) {
    const n: Point = [-line!.direction[1], line!.direction[0]]
    const w = e.confidence ** 2
    const rhs = dot(n, line!.point)
    a += w * n[0] * n[0]
    b += w * n[0] * n[1]
    c += w * n[1] * n[1]
    x += w * n[0] * rhs
    y += w * n[1] * rhs
  }
  const det = a * c - b * b
  if (det < 1e-4 * (a + c) ** 2) {
    return null
  }
  const center: Point = [(c * x - b * y) / det, (a * y - b * x) / det]
  if (
    !finite(center) ||
    center[0] < 0 ||
    center[1] < 0 ||
    center[0] >= width ||
    center[1] >= height
  ) {
    return null
  }
  const residual = Math.sqrt(
    best.reduce((sum, l) => sum + distance(center, l.line!) ** 2, 0) /
      best.length
  )
  return { center, inliers: best.map((l) => l.e), residual }
}
export function pointInPolygon([x, y]: Point, polygon: Point[]): boolean {
  let inside = false
  let j = polygon.length - 1
  for (let i = 0; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i]
    const [bx, by] = polygon[j]
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
      inside = !inside
    }
  }
  return inside
}
