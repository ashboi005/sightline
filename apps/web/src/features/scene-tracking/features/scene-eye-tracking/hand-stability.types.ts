import type { HandObservation } from "./scene.types"

export type StableHandResult = {
  hand: HandObservation
  preview: HandObservation | null
}
