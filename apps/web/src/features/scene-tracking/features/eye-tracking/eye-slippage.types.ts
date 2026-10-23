import type {
  Ellipse,
  EyeModel,
  FrameDimensions,
  Point,
  Rect,
} from "./eye-tracking.types"

export type EyeSlippage = {
  /** Limited evidence retains the last correction; it does not establish accuracy. */
  status: "collecting" | "stable" | "compensated" | "limited"
  /** Image-plane translation in full eye-frame pixels, subtracted before gaze projection. */
  offset: Point
  samples: number
  residual: number | null
}

export type EyeSlippageContext = FrameDimensions & {
  roi: Rect
  model: EyeModel | null
  locked: boolean
  timestamp: number
}

export type EyeSlippageObservation = {
  ellipse: Ellipse
  timestamp: number
}

export type EyeSlippageFit = {
  center: Point
  residual: number
  timestamp: number
}
