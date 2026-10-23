import type { GazeMeasurement, HandObservation } from "./scene.types"

export type SessionLog = {
  createdAt: string
  startedAt: number
  endedAt: number | null
  timeOrigin: number
  metadata: Record<string, unknown>
  measurements: GazeMeasurement[]
  hands: HandObservation[]
  truncated: boolean
}
