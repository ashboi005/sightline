import type { FrameDimensions } from "./eye-tracking.types"

export type PreviewStage = FrameDimensions & {
  image: FrameDimensions
}

export type PreviewCardFit = {
  card: FrameDimensions
  preview: FrameDimensions
  image: FrameDimensions
}
