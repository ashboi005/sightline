import type { Point } from "./eye-tracking.types"

export type MappingCoefficients = [number[], number[]]
export type AffineCoefficients = MappingCoefficients
export type MappingSample = { feature: Point; target: Point }
export type MappingPrediction = (feature: Point) => Point | null
export type MappingFitter = (
  samples: MappingSample[]
) => MappingPrediction | null
