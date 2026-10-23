import type { TrackingFrame } from "./eye-tracking.types"

export type UseTrackerWorkerCallbacks = {
  clearFrame: () => void
  stop: () => void
  setEngineReady: (ready: boolean) => void
  setError: (message: string) => void
  setFrame: (frame: TrackingFrame | null) => void
}
