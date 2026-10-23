export type ResidualFunction = (parameters: number[]) => number[] | null
export type ParameterBounds = { minimum: number[]; maximum: number[] }
export type NonlinearFit = { parameters: number[]; error: number; rank: number }
