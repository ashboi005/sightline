import type { EyeModel } from "./eye-tracking.types"

export type EyeModelReadinessInput = Pick<
  EyeModel,
  "samples" | "coverage" | "radius" | "residual" | "ready"
>

export type EyeModelLockStatus = {
  ready: boolean
  blocker:
    "waiting" | "corners" | "samples" | "coverage" | "radius" | "fit" | "ready"
  coveredDirections: number
  requiredDirections: number
  progress: number
}
