import type { Point, Rect } from "./eye-tracking.types"
import type { RegionBounds, ResizeHandle } from "./roi.types"
export const MIN_REGION_SIZE = 24
function clamp(value: number, min: number, max: number) {
  return Math.max(
    min,
    Math.min(max, Number.isFinite(value) ? Math.round(value) : min)
  )
}
/** Keep the region's size when moving it back inside the source image. */
export function clampRegion(region: Rect, bounds: RegionBounds): Rect {
  const width = clamp(
    region.width,
    Math.min(MIN_REGION_SIZE, bounds.width),
    bounds.width
  )
  const height = clamp(
    region.height,
    Math.min(MIN_REGION_SIZE, bounds.height),
    bounds.height
  )
  return {
    x: clamp(region.x, 0, bounds.width - width),
    y: clamp(region.y, 0, bounds.height - height),
    width,
    height,
  }
}
export function moveRegion(
  region: Rect,
  delta: Point,
  bounds: RegionBounds
): Rect {
  return clampRegion(
    { ...region, x: region.x + delta[0], y: region.y + delta[1] },
    bounds
  )
}
/** Resize from the starting box so a clamped pointer never moves the opposite edge. */
export function resizeRegion(
  region: Rect,
  handle: ResizeHandle,
  delta: Point,
  bounds: RegionBounds
): Rect {
  const box = clampRegion(region, bounds)
  const minWidth = Math.min(MIN_REGION_SIZE, bounds.width)
  const minHeight = Math.min(MIN_REGION_SIZE, bounds.height)
  let left = box.x
  let top = box.y
  let right = box.x + box.width
  let bottom = box.y + box.height
  if (handle.includes("w")) {
    left = clamp(left + delta[0], 0, right - minWidth)
  }
  if (handle.includes("e")) {
    right = clamp(right + delta[0], left + minWidth, bounds.width)
  }
  if (handle.includes("n")) {
    top = clamp(top + delta[1], 0, bottom - minHeight)
  }
  if (handle.includes("s")) {
    bottom = clamp(bottom + delta[1], top + minHeight, bounds.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}
export function regionFromPoints(
  start: Point,
  end: Point,
  bounds: RegionBounds
): Rect {
  const x1 = clamp(start[0], 0, bounds.width)
  const y1 = clamp(start[1], 0, bounds.height)
  const x2 = clamp(end[0], 0, bounds.width)
  const y2 = clamp(end[1], 0, bounds.height)
  return clampRegion(
    {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    },
    bounds
  )
}
