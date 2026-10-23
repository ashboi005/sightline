import type { Point } from "../eye-tracking.types"

export type GazeOffsetControlsProps = {
  offset: Point
  width: number
  height: number
  disabled?: boolean
  onCorrect: () => void
  onChange: (offset: Point) => void
}
