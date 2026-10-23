import type { Point, Rect, TrackingFrame } from "../eye-tracking.types"
import type { ResizeHandle } from "../roi.types"
import type { TrackerController } from "../use-tracker.types"

export type EyePreviewDrawingOptions = {
  frame: TrackingFrame | null
  roi: Rect
  corners: [Point, Point] | null
  selection?: Rect | null
  selectRegion?: boolean
  showModel?: boolean
  cornerMode?: ManualCornerMode | null
  view?: "image" | "threshold"
}

export type EyePreviewProps = {
  tracker: TrackerController
  selectRegion: boolean
  cornerMode: ManualCornerMode | null
  pendingCorner: Point | null
  onRegion: (roi: Rect) => void
  onCorner: (point: Point) => void
  onCornerModeChange: (mode: ManualCornerMode) => void
  onMoveCorners: (corners: [Point, Point]) => void
  onMovePendingCorner: (point: Point) => void
  onEditRegion?: () => void
  onThresholdViewChange?: (enabled: boolean) => void
  showModel?: boolean
  onTransformChange?: () => void
  transformDisabled?: boolean
  readOnly?: boolean
}

export type ManualCornerMode = "create" | "edit"

export type RegionGesture = {
  pointerId: number
  start: Point
  region: Rect
  mode: "draw" | "move" | ResizeHandle
}

export type ManualCornerGesture =
  | { pointerId: number; target: "pending"; start: Point }
  | {
      pointerId: number
      target: "point"
      index: number
      start: Point
      corners: [Point, Point]
    }
  | {
      pointerId: number
      target: "model"
      start: Point
      corners: [Point, Point]
    }

export type ManualCornerSelection =
  | { target: "pending"; point: Point }
  | { target: "model"; corners: [Point, Point] }

export type EyePreviewHandleDefinition = {
  handle: ResizeHandle
  label: string
  x: number
  y: number
}
