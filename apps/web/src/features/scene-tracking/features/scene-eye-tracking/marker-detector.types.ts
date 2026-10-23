import type { Point } from "../eye-tracking/eye-tracking.types"

import type { SceneObservation } from "./scene.types"

export type MarkerObservation = {
  scene: SceneObservation
  position: Point | null
  corners: Point[]
  reason?: string
}

export type MarkerImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type Ellipse = {
  x: number
  y: number
  rx: number
  ry: number
  angle: number
  error: number
}

export type Candidate = { outer: Ellipse; center: Point; quality: number }
