import type { ViewerCamera } from "./viewer-camera.types"
import type { PreviewPoint } from "./selection.types"

export type ObjectBox = readonly [number, number, number, number]
export type ObjectChoice = { point: PreviewPoint } | { box: ObjectBox }
export type FrameContext = {
  sourceKey: string
  transformKey: string
  generation: number
  timestamp: number
}
export type ObjectReference = FrameContext & {
  box: ObjectBox
  label: string
  token: string
  preview?: string
}
export type ObjectMatch = FrameContext & {
  box: ObjectBox
  score: number
  method?: "temporal" | "appearance" | "flow" | "person"
  identityMargin?: number
  detectionConfidence?: number
}
export type ObjectTrackingSnapshot = {
  status:
    | "idle"
    | "selecting"
    | "searching"
    | "matched"
    | "ambiguous"
    | "lost"
    | "error"
  reference: ObjectReference | null
  match: ObjectMatch | null
  scene?: ObjectMatch | null
  /** Display-only continuity. Never sent as movement evidence. */
  lastMatch?: ObjectMatch | null
  lastScene?: ObjectMatch | null
  sceneStatus?: "searching" | "matched" | "ambiguous" | "lost"
  targetStatus?: "searching" | "matched" | "ambiguous" | "lost"
  requiresReselect?: boolean
  selectionError?: string
  error: string
}
export type VisionRequest =
  | { action: "select"; image: string; point?: PreviewPoint; box?: ObjectBox }
  | { action: "match"; token: string; image: string; stream?: number }
  | { action: "track"; token: string; image: string }
  | { action: "clear"; token: string }
  | { action: "status" }
export type VisionRecord = Record<string, unknown>
export type VisionTransport = (
  request: VisionRequest,
  signal: AbortSignal
) => Promise<VisionRecord>
export type TrackingDependencies = {
  request?: VisionTransport
  encode?: (camera: ViewerCamera) => string
  now?: () => number
}
