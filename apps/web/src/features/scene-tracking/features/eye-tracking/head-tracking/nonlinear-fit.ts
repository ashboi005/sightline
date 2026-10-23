import type {
  NonlinearFit,
  ParameterBounds,
  ResidualFunction,
} from "./nonlinear-fit.types"
function squaredNorm(values: number[]): number {
  return values.reduce((sum, value) => sum + value * value, 0)
}
/** Partial-pivot elimination for the small, damped normal system. */
function solveSystem(matrix: number[][], right: number[]): number[] | null {
  const rows = matrix.map((row, index) => [...row, right[index]])
  const size = right.length
  for (let column = 0; column < size; column++) {
    let pivot = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row
      }
    }
    if (Math.abs(rows[pivot][column]) < 1e-14) {
      return null
    }
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    for (let row = column + 1; row < size; row++) {
      const multiplier = rows[row][column] / rows[column][column]
      for (let entry = column; entry <= size; entry++) {
        rows[row][entry] -= multiplier * rows[column][entry]
      }
    }
  }
  const solution = Array<number>(size).fill(0)
  for (let row = size - 1; row >= 0; row--) {
    let value = rows[row][size]
    for (let column = row + 1; column < size; column++) {
      value -= rows[row][column] * solution[column]
    }
    solution[row] = value / rows[row][row]
  }
  return solution.every(Number.isFinite) ? solution : null
}
function derivatives(
  parameters: number[],
  residual: number[],
  evaluate: ResidualFunction
): number[][] | null {
  const columns: number[][] = []
  for (let axis = 0; axis < parameters.length; axis++) {
    const step = 1e-5 * Math.max(1, Math.abs(parameters[axis]))
    const shifted = parameters.slice()
    shifted[axis] += step
    const values = evaluate(shifted)
    if (!values || values.length !== residual.length) {
      return null
    }
    columns.push(values.map((value, row) => (value - residual[row]) / step))
  }
  return columns
}
/** Pivoted, reorthogonalized QR reveals unobservable geometry; damping is not evidence of rank. */
function numericalRank(columns: number[][]): number {
  const remaining = columns.map((column) => column.slice())
  const maximumNorm = Math.max(
    ...remaining.map((column) => Math.sqrt(squaredNorm(column)))
  )
  if (!Number.isFinite(maximumNorm) || maximumNorm < 1e-12) {
    return 0
  }
  let rank = 0
  while (remaining.length > 0) {
    let pivot = 0
    for (let index = 1; index < remaining.length; index++) {
      if (squaredNorm(remaining[index]) > squaredNorm(remaining[pivot])) {
        pivot = index
      }
    }
    const [column] = remaining.splice(pivot, 1)
    const norm = Math.sqrt(squaredNorm(column))
    if (norm < maximumNorm * 1e-5) {
      break
    }
    const unit = column.map((value) => value / norm)
    for (const next of remaining) {
      for (let pass = 0; pass < 2; pass++) {
        const projection = next.reduce(
          (sum, value, row) => sum + value * unit[row],
          0
        )
        for (let row = 0; row < next.length; row++) {
          next[row] -= projection * unit[row]
        }
      }
    }
    rank++
  }
  return rank
}
/** Bounded Levenberg–Marquardt; no priors are used to disguise missing calibration data. */
export function fitNonlinearModel(
  initial: number[],
  bounds: ParameterBounds,
  evaluate: ResidualFunction
): NonlinearFit | null {
  let parameters = initial.slice()
  let residual = evaluate(parameters)
  if (!residual || !residual.every(Number.isFinite)) {
    return null
  }
  let cost = squaredNorm(residual)
  let damping = 0.001
  for (let iteration = 0; iteration < 140; iteration++) {
    const columns = derivatives(parameters, residual, evaluate)
    if (!columns) {
      return null
    }
    const matrix = columns.map((left) =>
      columns.map((right) =>
        left.reduce((sum, value, row) => sum + value * right[row], 0)
      )
    )
    const gradient = columns.map(
      (column) =>
        -column.reduce((sum, value, row) => sum + value * residual![row], 0)
    )
    for (let axis = 0; axis < parameters.length; axis++) {
      matrix[axis][axis] += damping * Math.max(matrix[axis][axis], 0.0001)
    }
    const change = solveSystem(matrix, gradient)
    if (!change) {
      return null
    }
    const candidate = parameters.map((value, axis) =>
      Math.max(
        bounds.minimum[axis],
        Math.min(bounds.maximum[axis], value + change[axis])
      )
    )
    const candidateResidual = evaluate(candidate)
    let candidateCost = Infinity
    if (candidateResidual?.every(Number.isFinite)) {
      candidateCost = squaredNorm(candidateResidual)
    }
    if (candidateCost < cost) {
      const improvement = cost - candidateCost
      parameters = candidate
      residual = candidateResidual!
      cost = candidateCost
      damping = Math.max(1e-9, damping / 3)
      if (improvement < 1e-13 || cost < 1e-14) {
        break
      }
    } else {
      damping *= 5
      if (damping > 1e10) {
        break
      }
    }
  }
  const columns = derivatives(parameters, residual, evaluate)
  if (!columns) {
    return null
  }
  return {
    parameters,
    error: Math.sqrt(cost / residual.length),
    rank: numericalRank(columns),
  }
}
