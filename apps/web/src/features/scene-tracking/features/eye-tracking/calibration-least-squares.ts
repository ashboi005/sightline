import type { MappingCoefficients } from "./calibration-mapping.types"
import type { Point } from "./eye-tracking.types"

/** QR least squares for the two screen coordinates; no matrix inverse is formed. */
export function fitScreenCoordinates(
  rows: number[][],
  targets: Point[]
): MappingCoefficients | null {
  const count = rows.length
  const columns = rows[0]?.length ?? 0
  if (columns === 0 || count < columns || targets.length !== count) {
    return null
  }
  const orthogonal: number[][] = []
  const triangular = Array.from({ length: columns }, () =>
    Array<number>(columns).fill(0)
  )
  for (let column = 0; column < columns; column++) {
    const values = rows.map((row) => row[column])
    // Reorthogonalize to avoid cancellation when the features are correlated.
    for (let pass = 0; pass < 2; pass++) {
      for (let previous = 0; previous < column; previous++) {
        let projection = 0
        for (let row = 0; row < count; row++) {
          projection += orthogonal[previous][row] * values[row]
        }
        triangular[previous][column] += projection
        for (let row = 0; row < count; row++) {
          values[row] -= projection * orthogonal[previous][row]
        }
      }
    }
    const length = Math.hypot(...values)
    if (!Number.isFinite(length) || length < 0.001 * Math.sqrt(count)) {
      return null
    }
    triangular[column][column] = length
    orthogonal.push(values.map((value) => value / length))
  }
  const coefficients: MappingCoefficients = [[], []]
  for (let axis = 0; axis < 2; axis++) {
    const values = orthogonal.map((column) =>
      column.reduce((sum, value, row) => sum + value * targets[row][axis], 0)
    )
    for (let row = columns - 1; row >= 0; row--) {
      for (let column = row + 1; column < columns; column++) {
        values[row] -= triangular[row][column] * values[column]
      }
      values[row] /= triangular[row][row]
    }
    if (!values.every(Number.isFinite)) {
      return null
    }
    coefficients[axis] = values
  }
  return coefficients
}
