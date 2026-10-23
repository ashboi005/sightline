import type { PupilArcEvidence, RefinedPupilContour } from "./detection.types"
// Adapted from JEOresearch/EyeTracker (MIT). See research/EyeTracker-LICENSE.
import type {
  CvOwnedObject,
  DarkestPatch,
  PupilBoundaryEvidence,
  PupilCandidate,
  PupilContourRegion,
  PupilDetectionOptions,
  PupilProposal,
  PupilRimIdentity,
  PupilRimSample,
} from "./detection.types"
import type { Detection, Ellipse, Point } from "./eye-tracking.types"
import { finite, pointInPolygon } from "./geometry"
import type { CV } from "./opencv.types"
const maxContourCandidates = 24
const maxContourPoints = 256
const recoveryTrials = 24
const maxPartialConfidence = 0.8
const inwardDepths = [0.4, 0.6, 0.8]
const rimDirections: Point[] = Array.from({ length: 64 }, (_, i) => [
  Math.cos((i * Math.PI) / 32),
  Math.sin((i * Math.PI) / 32),
])
/** A dimensionless cosine, unlike the reference's unnormalized dot product. */
export function refineContour(points: Point[]): Point[] {
  if (points.length < 6) {
    return []
  }
  const center: Point = [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ]
  const spacing = Math.max(1, Math.floor(points.length / 25))
  return points.filter((p, i) => {
    const before = points[(i - spacing + points.length) % points.length]
    const after = points[(i + spacing) % points.length]
    const a: Point = [before[0] - p[0], before[1] - p[1]]
    const b: Point = [after[0] - p[0], after[1] - p[1]]
    const la = Math.hypot(...a)
    const lb = Math.hypot(...b)
    if (la < 1e-9 || lb < 1e-9) {
      return false
    }
    const inward: Point = [a[0] / la + b[0] / lb, a[1] / la + b[1] / lb]
    const toward: Point = [center[0] - p[0], center[1] - p[1]]
    const norm = Math.hypot(...inward) * Math.hypot(...toward)
    return (
      norm > 1e-9 &&
      (inward[0] * toward[0] + inward[1] * toward[1]) / norm >= 0.5
    )
  })
}
/** Open edge chains have no meaningful centroid. Keep bends, excluding straight runs and reversals. */
function curvedEdgePoints(points: Point[]): Point[] {
  const spacing = Math.max(2, Math.floor(points.length / 64))
  return points.filter((point, i) => {
    if (i < spacing || i + spacing >= points.length) {
      return false
    }
    const before = points[i - spacing]
    const after = points[i + spacing]
    const ax = before[0] - point[0]
    const ay = before[1] - point[1]
    const bx = after[0] - point[0]
    const by = after[1] - point[1]
    const a = Math.hypot(ax, ay)
    const b = Math.hypot(bx, by)
    if (a < 1 || b < 1 || Math.max(a, b) > Math.min(a, b) * 4) {
      return false
    }
    const bend = Math.hypot(ax / a + bx / b, ay / a + by / b)
    return bend > 0.08 && bend < 1.6
  })
}
function darkestPatch(
  gray: Uint8Array,
  width: number,
  height: number,
  minimumIntensity = 0,
  centerRegion?: Point[]
): DarkestPatch | null {
  const size = Math.max(3, Math.round(Math.min(width, height) / 24))
  const half = Math.floor(size / 2)
  const stride = Math.max(2, half)
  let best = Infinity
  let result: DarkestPatch | null = null
  for (let y = half + 2; y < height - half - 2; y += stride) {
    for (let x = half + 2; x < width - half - 2; x += stride) {
      if (centerRegion && !pointInPolygon([x, y], centerRegion)) {
        continue
      }
      let sum = 0
      let sum2 = 0
      let n = 0
      let lowest = 255
      for (let dy = -half; dy <= half; dy += 2) {
        for (let dx = -half; dx <= half; dx += 2) {
          const v = gray[(y + dy) * width + x + dx]
          lowest = Math.min(lowest, v)
          sum += v
          sum2 += v * v
          n++
        }
      }
      if (lowest < minimumIntensity) {
        continue
      }
      const mean = sum / n
      const variance = Math.max(0, sum2 / n - mean * mean)
      const score = mean + 0.25 * Math.sqrt(variance)
      if (score < best) {
        best = score
        result = { point: [x, y], value: mean }
      }
    }
  }
  return result
}
/** Recognize blank frame padding without excluding a dark pupil inside the image. */
function hasBlackPadding(
  gray: Uint8Array,
  width: number,
  height: number
): boolean {
  const blankRow = (y: number) => {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] > 1) {
        return false
      }
    }
    return true
  }
  const blankColumn = (x: number) => {
    for (let y = 0; y < height; y++) {
      if (gray[y * width + x] > 1) {
        return false
      }
    }
    return true
  }
  return (
    blankRow(0) ||
    blankRow(height - 1) ||
    blankColumn(0) ||
    blankColumn(width - 1)
  )
}
function convertEllipse(rect: ReturnType<CV["fitEllipse"]>): Ellipse {
  const width = rect.size.width
  const height = rect.size.height
  let angle = (rect.angle * Math.PI) / 180 + (height > width ? Math.PI / 2 : 0)
  angle = ((angle % Math.PI) + Math.PI) % Math.PI
  return {
    center: [rect.center.x, rect.center.y],
    major: Math.max(width, height) / 2,
    minor: Math.min(width, height) / 2,
    angle,
    confidence: 0,
  }
}
function edgeError(p: Point, e: Ellipse): number {
  const dx = p[0] - e.center[0]
  const dy = p[1] - e.center[1]
  const c = Math.cos(e.angle)
  const s = Math.sin(e.angle)
  const u = c * dx + s * dy
  const v = -s * dx + c * dy
  const gradient = 2 * Math.hypot(u / e.major ** 2, v / e.minor ** 2)
  // First-order distance to the implicit ellipse, in pixels. Scaling radial
  // error by the minor axis understates errors at the ends of an oblique pupil.
  return gradient > 1e-9
    ? Math.abs((u / e.major) ** 2 + (v / e.minor) ** 2 - 1) / gradient
    : Infinity
}
function validEllipse(e: Ellipse, width: number, height: number): boolean {
  const c = Math.cos(e.angle)
  const s = Math.sin(e.angle)
  const radiusX = Math.hypot(e.major * c, e.minor * s)
  const radiusY = Math.hypot(e.major * s, e.minor * c)
  return (
    finite([...e.center, e.major, e.minor, e.angle]) &&
    e.minor >= 3 &&
    e.minor / e.major >= 0.2 &&
    radiusX < width * 0.6 &&
    radiusY < height * 0.6 &&
    e.center[0] >= 0 &&
    e.center[1] >= 0 &&
    e.center[0] < width &&
    e.center[1] < height
  )
}
/** Preserve pupil identity without restricting off-axis changes to the minor axis. */
function compatiblePupilScale(
  ellipse: Ellipse,
  anchor: Ellipse | null | undefined,
  confirmed = false
): boolean {
  if (!anchor) {
    return true
  }
  const majorRatio = ellipse.major / anchor.major
  const areaRatio =
    (ellipse.major * ellipse.minor) / (anchor.major * anchor.minor)
  return confirmed
    ? majorRatio >= 0.55 &&
        majorRatio <= 1.6 &&
        (majorRatio >= 0.8 || areaRatio >= 0.4)
    : majorRatio >= 0.35
}
function normalizedRadius(point: Point, ellipse: Ellipse): number {
  const dx = point[0] - ellipse.center[0]
  const dy = point[1] - ellipse.center[1]
  const c = Math.cos(ellipse.angle)
  const s = Math.sin(ellipse.angle)
  return Math.hypot(
    (c * dx + s * dy) / ellipse.major,
    (-s * dx + c * dy) / ellipse.minor
  )
}
function sampleGray(
  gray: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): number | null {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    return null
  }
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const dx = x - ix
  const dy = y - iy
  const index = iy * width + ix
  return (
    (1 - dy) * ((1 - dx) * gray[index] + dx * gray[index + 1]) +
    dy * ((1 - dx) * gray[index + width] + dx * gray[index + width + 1])
  )
}
/** A lash can be dark and elliptical locally; require outward contrast around the rim. */
function boundaryEvidence(
  gray: Uint8Array,
  width: number,
  height: number,
  e: Ellipse,
  reflectionLimit = Infinity
): PupilBoundaryEvidence {
  const c = Math.cos(e.angle)
  const s = Math.sin(e.angle)
  const step = Math.max(1.5, Math.min(5, e.minor * 0.12))
  const differences: number[] = []
  for (const [ca, sa] of rimDirections) {
    const x = e.center[0] + c * e.major * ca - s * e.minor * sa
    const y = e.center[1] + s * e.major * ca + c * e.minor * sa
    const nx = (c * ca) / e.major - (s * sa) / e.minor
    const ny = (s * ca) / e.major + (c * sa) / e.minor
    const length = Math.hypot(nx, ny)
    const dx = (nx * step) / length
    const dy = (ny * step) / length
    const inside = sampleGray(gray, width, height, x - dx, y - dy)
    const outside = sampleGray(gray, width, height, x + dx, y + dy)
    if (
      inside !== null &&
      outside !== null &&
      inside < reflectionLimit &&
      outside < reflectionLimit &&
      outside - inside >= 6
    ) {
      differences.push(outside - inside)
    }
  }
  differences.sort((a, b) => a - b)
  return {
    support: differences.length / 64,
    contrast: differences[Math.floor(differences.length / 2)] ?? 0,
  }
}
/** During partial occlusion, solve only translation from fresh edge measurements.
 * Holding the last measured axes avoids an unconstrained ellipse fit collapsing
 * onto the lid. A poorly conditioned or unsupported translation is rejected.
 */
function trackPartialRim(
  gray: Uint8Array,
  width: number,
  height: number,
  previous: Ellipse,
  samples: PupilRimSample[],
  band: number
): PupilCandidate | null {
  const solve = (inliers: PupilRimSample[]): Point | null => {
    let xx = 0
    let xy = 0
    let yy = 0
    let bx = 0
    let by = 0
    for (const {
      normal: [nx, ny],
      offset,
    } of inliers) {
      xx += nx * nx
      xy += nx * ny
      yy += ny * ny
      bx += nx * offset
      by += ny * offset
    }
    const determinant = xx * yy - xy * xy
    if (determinant < xx * yy * 0.2 || determinant < 1e-6) {
      return null
    }
    const dx = (yy * bx - xy * by) / determinant
    const dy = (xx * by - xy * bx) / determinant
    if (Math.hypot(dx, dy) > band) {
      return null
    }
    return [dx, dy]
  }
  const supporting = ([dx, dy]: Point) =>
    samples.filter(
      ({ normal: [nx, ny], offset }) =>
        Math.abs(nx * dx + ny * dy - offset) <= 2
    )
  // Lash edges are outliers. Seed translation with bounded pairs before least-squares refinement.
  if (samples.length < 20) {
    return null
  }
  let inliers: PupilRimSample[] = []
  for (let trial = 0; trial < 24; trial++) {
    const first = Math.floor(((trial + 0.5) * samples.length) / 24)
    const second =
      (first +
        Math.max(
          1,
          Math.floor(samples.length * (0.25 + (trial % 3) * 0.125))
        )) %
      samples.length
    const translation = solve([samples[first], samples[second]])
    if (!translation) {
      continue
    }
    const candidate = supporting(translation)
    if (candidate.length > inliers.length) {
      inliers = candidate
    }
  }
  if (inliers.length < Math.max(20, samples.length * 0.45)) {
    return null
  }
  let translation = solve(inliers)
  if (!translation) {
    return null
  }
  inliers = supporting(translation)
  if (inliers.length < 20) {
    return null
  }
  translation = solve(inliers)
  if (!translation) {
    return null
  }
  const [dx, dy] = translation
  const ellipse: Ellipse = {
    ...previous,
    center: [previous.center[0] + dx, previous.center[1] + dy],
  }
  if (!validEllipse(ellipse, width, height)) {
    return null
  }
  const boundary = boundaryEvidence(gray, width, height, ellipse)
  if (boundary.support < 0.4 || boundary.contrast < 10) {
    return null
  }
  ellipse.confidence = Math.min(
    maxPartialConfidence,
    0.6 + 0.35 * boundary.support
  )
  const points = samples.map((sample) => sample.point)
  const refined = inliers.map((sample) => sample.point)
  return {
    ellipse,
    points,
    refined,
    index: 0,
    score: ellipse.confidence,
    shapeObserved: false,
  }
}
/** Classify pixels before interpolation: a lash/iris blend can mimic pupil gray. */
function pupilIntensityMembership(
  gray: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  minimum: number,
  maximum: number
): number | null {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    return null
  }
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const dx = x - ix
  const dy = y - iy
  const index = iy * width + ix
  const topLeft = gray[index]
  const topRight = gray[index + 1]
  const bottomLeft = gray[index + width]
  const bottomRight = gray[index + width + 1]
  return (
    (1 - dy) *
      ((1 - dx) * Number(topLeft >= minimum && topLeft <= maximum) +
        dx * Number(topRight >= minimum && topRight <= maximum)) +
    dy *
      ((1 - dx) * Number(bottomLeft >= minimum && bottomLeft <= maximum) +
        dx * Number(bottomRight >= minimum && bottomRight <= maximum))
  )
}
/** Check the observed arc's dark interior, rather than the occluded ellipse area. */
function pupilEdgeContrast(
  gray: Uint8Array,
  width: number,
  height: number,
  ellipse: Ellipse,
  x: number,
  y: number,
  nx: number,
  ny: number,
  identity: PupilRimIdentity,
  requirePersistentExterior = false
): number {
  const probe = Math.max(1.5, Math.min(5, ellipse.minor * 0.12))
  const inside = sampleGray(gray, width, height, x - probe * nx, y - probe * ny)
  const outside = sampleGray(
    gray,
    width,
    height,
    x + probe * nx,
    y + probe * ny
  )
  if (
    inside === null ||
    outside === null ||
    inside > identity.maximumIntensity + 16 ||
    inside >= identity.reflectionLimit ||
    outside >= identity.reflectionLimit ||
    outside - inside < 10
  ) {
    return 0
  }
  if (requirePersistentExterior) {
    const start = probe * 2
    const end = Math.max(start, Math.min(32, ellipse.minor * 0.6))
    const minimumDrop = (outside - inside) * 0.5
    let observed = false
    // A single distant sample can skip the dark return after an internal
    // reflection. Inspect the bounded path, ignoring glints and other dark objects.
    for (let depth = start; depth <= end; depth++) {
      const px = x + depth * nx
      const py = y + depth * ny
      const exterior = sampleGray(gray, width, height, px, py)
      if (exterior === null || exterior >= identity.reflectionLimit) {
        continue
      }
      if (
        outside - exterior >= minimumDrop &&
        (pupilIntensityMembership(
          gray,
          width,
          height,
          px,
          py,
          identity.minimumIntensity,
          identity.maximumIntensity
        ) ?? 0) >= 0.5
      ) {
        return 0
      }
      if (exterior - inside >= 6) {
        observed = true
      }
    }
    if (!observed) {
      return 0
    }
  }
  // The shallow check excludes an iris edge surrounding a darker pupil.
  // Multiple deeper samples allow a glint to cross one inward path.
  for (const fraction of inwardDepths) {
    const depth = Math.max(probe * 2, ellipse.minor * fraction)
    const core = sampleGray(gray, width, height, x - depth * nx, y - depth * ny)
    if (core !== null && core <= identity.maximumIntensity) {
      return outside - inside
    }
  }
  return 0
}
function pupilArcCondition(samples: PupilRimSample[]): number {
  let xx = 0
  let xy = 0
  let yy = 0
  for (const {
    normal: [nx, ny],
  } of samples) {
    xx += nx * nx
    xy += nx * ny
    yy += ny * ny
  }
  const trace = xx + yy
  const spread = Math.hypot(xx - yy, 2 * xy)
  return trace + spread > 0 ? (trace - spread) / (trace + spread) : 0
}
/** Measure center and common scale; preserve the unobserved aspect ratio/angle. */
function trackConstrainedPupilRim(
  gray: Uint8Array,
  width: number,
  height: number,
  previous: Ellipse,
  allSamples: PupilRimSample[],
  band: number,
  identity: PupilRimIdentity
): PupilCandidate | null {
  const samples = allSamples.filter(
    ({ point: [x, y], normal: [nx, ny] }) =>
      pupilEdgeContrast(gray, width, height, previous, x, y, nx, ny, identity) >
      0
  )
  if (samples.length < 20) {
    return null
  }
  const coefficients = ({
    point: [x, y],
    normal: [nx, ny],
    offset,
  }: PupilRimSample) => [
    nx,
    ny,
    (nx * (x - previous.center[0]) + ny * (y - previous.center[1]) - offset) /
      previous.major,
  ]
  const solve = (inliers: PupilRimSample[]): number[] | null => {
    const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0])
    for (const sample of inliers) {
      const row = coefficients(sample)
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          matrix[i][j] += row[i] * row[j]
        }
        matrix[i][3] += row[i] * sample.offset
      }
    }
    for (let column = 0; column < 3; column++) {
      let pivot = column
      for (let row = column + 1; row < 3; row++) {
        if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
          pivot = row
        }
      }
      ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]
      const divisor = matrix[column][column]
      if (Math.abs(divisor) < 1e-7) {
        return null
      }
      for (let j = column; j < 4; j++) {
        matrix[column][j] /= divisor
      }
      for (let row = 0; row < 3; row++) {
        if (row === column) {
          continue
        }
        const multiplier = matrix[row][column]
        for (let j = column; j < 4; j++) {
          matrix[row][j] -= multiplier * matrix[column][j]
        }
      }
    }
    const fit = matrix.map((row) => row[3])
    const scale = 1 + fit[2] / previous.major
    return finite(fit) &&
      Math.hypot(fit[0], fit[1]) <= band &&
      scale >= 0.85 &&
      scale <= 1.15
      ? fit
      : null
  }
  const supporting = (fit: number[]) =>
    samples.filter((sample) => {
      const row = coefficients(sample)
      return (
        Math.abs(
          row[0] * fit[0] + row[1] * fit[1] + row[2] * fit[2] - sample.offset
        ) <= 2
      )
    })
  let inliers: PupilRimSample[] = []
  for (let trial = 0; trial < recoveryTrials; trial++) {
    const first = Math.floor(((trial + 0.5) * samples.length) / recoveryTrials)
    const second =
      (first + Math.floor(samples.length * (0.25 + (trial % 3) * 0.0625))) %
      samples.length
    const third =
      (first + Math.floor(samples.length * (0.6 + (trial % 2) * 0.0625))) %
      samples.length
    const fit = solve([samples[first], samples[second], samples[third]])
    if (!fit) {
      continue
    }
    const candidate = supporting(fit)
    if (candidate.length > inliers.length) {
      inliers = candidate
    }
  }
  if (inliers.length < Math.max(20, samples.length * 0.45)) {
    return null
  }
  let fit = solve(inliers)
  if (!fit) {
    return null
  }
  inliers = supporting(fit)
  if (inliers.length < 20 || pupilArcCondition(inliers) < 0.2) {
    return null
  }
  fit = solve(inliers)
  if (!fit) {
    return null
  }
  const scale = 1 + fit[2] / previous.major
  const ellipse: Ellipse = {
    ...previous,
    center: [previous.center[0] + fit[0], previous.center[1] + fit[1]],
    major: previous.major * scale,
    minor: previous.minor * scale,
  }
  if (!validEllipse(ellipse, width, height)) {
    return null
  }
  const boundary = boundaryEvidence(
    gray,
    width,
    height,
    ellipse,
    identity.reflectionLimit
  )
  if (boundary.support < 0.4 || boundary.contrast < 10) {
    return null
  }
  ellipse.confidence = Math.min(
    maxPartialConfidence,
    0.6 + 0.35 * boundary.support
  )
  return {
    ellipse,
    points: samples.map((sample) => sample.point),
    refined: inliers.map((sample) => sample.point),
    index: 0,
    score: ellipse.confidence,
    shapeObserved: false,
  }
}
function darkPupilBoundary(
  gray: Uint8Array,
  width: number,
  height: number,
  ellipse: Ellipse,
  identity: PupilRimIdentity,
  checkPersistence = false
): PupilBoundaryEvidence & PupilArcEvidence {
  const c = Math.cos(ellipse.angle)
  const s = Math.sin(ellipse.angle)
  const differences: number[] = []
  let persistent = 0
  let xx = 0
  let xy = 0
  let yy = 0
  for (const [ca, sa] of rimDirections) {
    const x =
      ellipse.center[0] + c * ellipse.major * ca - s * ellipse.minor * sa
    const y =
      ellipse.center[1] + s * ellipse.major * ca + c * ellipse.minor * sa
    const nx = (c * ca) / ellipse.major - (s * sa) / ellipse.minor
    const ny = (s * ca) / ellipse.major + (c * sa) / ellipse.minor
    const length = Math.hypot(nx, ny)
    const contrast = pupilEdgeContrast(
      gray,
      width,
      height,
      ellipse,
      x,
      y,
      nx / length,
      ny / length,
      identity
    )
    if (contrast > 0) {
      differences.push(contrast)
      const normalX = nx / length
      const normalY = ny / length
      xx += normalX * normalX
      xy += normalX * normalY
      yy += normalY * normalY
      if (
        checkPersistence &&
        pupilEdgeContrast(
          gray,
          width,
          height,
          ellipse,
          x,
          y,
          normalX,
          normalY,
          identity,
          true
        ) > 0
      ) {
        persistent++
      }
    }
  }
  differences.sort((a, b) => a - b)
  const trace = xx + yy
  const spread = Math.hypot(xx - yy, 2 * xy)
  return {
    support: differences.length / 64,
    contrast: differences[Math.floor(differences.length / 2)] ?? 0,
    persistentFraction: differences.length
      ? persistent / differences.length
      : 0,
    arcCondition: trace + spread > 0 ? (trace - spread) / (trace + spread) : 0,
  }
}
function supportedFullPupilRim(
  gray: Uint8Array,
  width: number,
  height: number,
  ellipse: Ellipse,
  identity: PupilRimIdentity
): boolean {
  const boundary = darkPupilBoundary(
    gray,
    width,
    height,
    ellipse,
    identity,
    true
  )
  return (
    ellipse.confidence >= 0.8 &&
    boundary.support >= 0.25 &&
    boundary.arcCondition >= 0.2 &&
    boundary.persistentFraction >= 0.9
  )
}
/** Track observed edges near the last rim before attempting another segmentation.
 * The outline-first strategy follows PuReST's separation of tracking and detection;
 * this implementation samples grayscale normal profiles, not their Canny pipeline.
 */
function trackPupilRim(
  cv: CV,
  gray: Uint8Array,
  width: number,
  height: number,
  previous: Ellipse,
  anchor: Ellipse,
  reacquiring = false,
  shapeReference: Ellipse | null = null,
  identity: PupilRimIdentity | null = null
): PupilCandidate | null {
  if (!validEllipse(previous, width, height)) {
    return null
  }
  const band = Math.max(
    3,
    Math.min(
      reacquiring || identity ? 18 : 12,
      Math.round(previous.minor * (reacquiring || identity ? 0.4 : 0.22))
    )
  )
  const probe = Math.max(1, Math.min(2.5, previous.minor * 0.07))
  const c = Math.cos(previous.angle)
  const s = Math.sin(previous.angle)
  const samples: PupilRimSample[] = []
  const profile = new Float64Array(band * 2 + 1)
  const reflectionLimit =
    identity?.reflectionLimit ??
    pupilContrast(gray, width, height, previous).reflectionLimit
  const rejectInteriorPeaks =
    reacquiring &&
    shapeReference &&
    previous.minor < shapeReference.minor * 0.8 &&
    previous.major >= shapeReference.major * 0.8 &&
    Math.hypot(
      previous.center[0] - shapeReference.center[0],
      previous.center[1] - shapeReference.center[1]
    ) <
      shapeReference.major * 0.75
  for (const [ca, sa] of rimDirections) {
    const x =
      previous.center[0] + c * previous.major * ca - s * previous.minor * sa
    const y =
      previous.center[1] + s * previous.major * ca + c * previous.minor * sa
    const normalX = (c * ca) / previous.major - (s * sa) / previous.minor
    const normalY = (s * ca) / previous.major + (c * sa) / previous.minor
    const length = Math.hypot(normalX, normalY)
    const nx = normalX / length
    const ny = normalY / length
    let peak = -1
    let best = reacquiring ? 4 : 6
    for (let offset = -band; offset <= band; offset++) {
      const inside = sampleGray(
        gray,
        width,
        height,
        x + (offset - probe) * nx,
        y + (offset - probe) * ny
      )
      const outside = sampleGray(
        gray,
        width,
        height,
        x + (offset + probe) * nx,
        y + (offset + probe) * ny
      )
      const gradient =
        inside === null ||
        outside === null ||
        inside >= reflectionLimit ||
        outside >= reflectionLimit
          ? 0
          : outside - inside
      profile[offset + band] = gradient
      const score = gradient / (1 + 0.02 * Math.abs(offset))
      if (
        score > best &&
        (!identity ||
          pupilEdgeContrast(
            gray,
            width,
            height,
            previous,
            x + offset * nx,
            y + offset * ny,
            nx,
            ny,
            identity,
            true
          ) > 0)
      ) {
        best = score
        peak = offset + band
      }
    }
    if (peak <= 0 || peak >= profile.length - 1) {
      continue
    }
    // Center a derivative peak instead of retaining the old pixel on a flat peak.
    let weight = 0
    // Center a derivative peak instead of retaining the old pixel on a flat peak.
    let position = 0
    for (
      let i = Math.max(0, peak - 2);
      i <= Math.min(profile.length - 1, peak + 2);
      i++
    ) {
      const w = Math.max(0, profile[i] - profile[peak] * 0.5)
      weight += w
      position += (i - band) * w
    }
    if (!weight) {
      continue
    }
    const offset = position / weight
    const px = x + offset * nx
    const py = y + offset * ny
    const inside = sampleGray(
      gray,
      width,
      height,
      px - 2 * probe * nx,
      py - 2 * probe * ny
    )
    const outside = sampleGray(
      gray,
      width,
      height,
      px + 2 * probe * nx,
      py + 2 * probe * ny
    )
    const farOutside = rejectInteriorPeaks
      ? sampleGray(
          gray,
          width,
          height,
          px + Math.max(2 * probe, previous.minor * 0.6) * nx,
          py + Math.max(2 * probe, previous.minor * 0.6) * ny
        )
      : outside
    // Thin lashes have bright pixels on both sides; a pupil edge has a dark interior.
    if (
      inside !== null &&
      outside !== null &&
      farOutside !== null &&
      inside < reflectionLimit &&
      outside < reflectionLimit &&
      outside - inside >= (reacquiring ? 6 : 10) &&
      // A diffuse reflection inside the pupil can make a strong local edge.
      // A new outline must brighten beyond that peak rather than return to dark core.
      (!rejectInteriorPeaks ||
        (farOutside < reflectionLimit && farOutside - inside >= 6))
    ) {
      samples.push({ point: [px, py], normal: [nx, ny], offset })
    }
  }
  const points = samples.map((sample) => sample.point)
  const partial = () =>
    identity
      ? trackConstrainedPupilRim(
          gray,
          width,
          height,
          previous,
          samples,
          band,
          identity
        )
      : trackPartialRim(gray, width, height, previous, samples, band)
  if (points.length < 36) {
    return partial()
  }
  const fit = (sample: Point[]) => {
    const mat = cv.matFromArray(sample.length, 1, cv.CV_32FC2, sample.flat())
    try {
      return convertEllipse(cv.fitEllipse(mat))
    } finally {
      mat.delete()
    }
  }
  let refined = points
  let ellipse = fit(refined)
  for (let iteration = 0; iteration < 2; iteration++) {
    if (!validEllipse(ellipse, width, height)) {
      return partial()
    }
    const tolerance = Math.max(1.25, Math.min(3, ellipse.minor * 0.07))
    refined = refined.filter((point) => edgeError(point, ellipse) <= tolerance)
    if (refined.length < 32) {
      return partial()
    }
    ellipse = fit(refined)
  }
  if (
    !validEllipse(ellipse, width, height) ||
    Math.hypot(
      ellipse.center[0] - previous.center[0],
      ellipse.center[1] - previous.center[1]
    ) >
      band * 1.5 ||
    ellipse.major / previous.major < (reacquiring ? 0.65 : 0.8) ||
    ellipse.major / previous.major > (reacquiring ? 1.4 : 1.25) ||
    ellipse.minor / previous.minor < (reacquiring ? 0.5 : 0.8) ||
    ellipse.minor / previous.minor > (reacquiring ? 1.75 : 1.25) ||
    ellipse.major / anchor.major > 1.2
  ) {
    return partial()
  }
  const sectors = new Set<number>()
  const ec = Math.cos(ellipse.angle)
  const es = Math.sin(ellipse.angle)
  for (const [x, y] of refined) {
    const dx = x - ellipse.center[0]
    const dy = y - ellipse.center[1]
    const angle = Math.atan2(
      (-es * dx + ec * dy) / ellipse.minor,
      (ec * dx + es * dy) / ellipse.major
    )
    sectors.add(Math.min(31, Math.floor(((angle + Math.PI) * 16) / Math.PI)))
  }
  // Support must be spread around the pupil; a single eyelid arc is insufficient.
  let gap = 0
  for (let i = 0; i < 64; i++) {
    gap = sectors.has(i % 32) ? 0 : gap + 1
    if (gap > 12) {
      return partial()
    }
  }
  const boundary = boundaryEvidence(
    gray,
    width,
    height,
    ellipse,
    reflectionLimit
  )
  if (!reacquiring && boundary.support < 0.8) {
    const translated = partial()
    if (translated) {
      return translated
    }
  }
  if (
    sectors.size < 18 ||
    boundary.support < 0.55 ||
    boundary.contrast < (reacquiring ? 6 : 10)
  ) {
    return partial()
  }
  ellipse.confidence = Math.min(
    0.99,
    0.55 + 0.45 * boundary.support,
    reacquiring
      ? 0.6 + (0.4 * refined.length) / points.length
      : refined.length / points.length
  )
  if (ellipse.confidence < 0.72) {
    return partial()
  }
  if (
    identity &&
    (!supportedFullPupilRim(gray, width, height, ellipse, identity) ||
      !strongPupilEvidence(
        ellipse,
        pupilContrast(gray, width, height, ellipse),
        boundary
      ))
  ) {
    return partial()
  }
  return { ellipse, points, refined, index: 0, score: ellipse.confidence }
}
/** Recenter a recently tracked shape after a saccade, including partial lash occlusion. */
function relocatePupilRim(
  cv: CV,
  gray: Uint8Array,
  width: number,
  height: number,
  previous: Ellipse,
  anchor: Ellipse,
  patch: DarkestPatch,
  identity: PupilRimIdentity | null = null,
  requireFullEvidence = false
): PupilCandidate | null {
  const radius = Math.max(12, Math.min(96, previous.major * 1.6))
  const step = Math.max(4, Math.ceil(radius / 8))
  const seeds: Pick<PupilCandidate, "ellipse" | "score">[] = []
  // At most 17 × 17 center hypotheses; there is no image pyramid or full-frame search here.
  for (const scale of identity ? [1.2, 1, 0.75] : [1]) {
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const distance = Math.hypot(dx * step, dy * step)
        if (distance > radius || (distance < step && scale === 1)) {
          continue
        }
        const ellipse: Ellipse = {
          ...previous,
          major: previous.major * scale,
          minor: previous.minor * scale,
          center: [
            previous.center[0] + dx * step,
            previous.center[1] + dy * step,
          ],
        }
        if (
          !validEllipse(ellipse, width, height) ||
          (identity && !compatiblePupilScale(ellipse, anchor, true))
        ) {
          continue
        }
        const boundary = identity
          ? darkPupilBoundary(gray, width, height, ellipse, identity)
          : boundaryEvidence(gray, width, height, ellipse)
        if (
          boundary.support < (identity ? 0.25 : 0.4) ||
          boundary.contrast < 10
        ) {
          continue
        }
        const score =
          boundary.support * (0.6 + 0.4 * Math.min(1, boundary.contrast / 40)) -
          (0.05 * distance) / radius
        if (identity) {
          const duplicate = seeds.findIndex(
            (seed) =>
              Math.hypot(
                seed.ellipse.center[0] - ellipse.center[0],
                seed.ellipse.center[1] - ellipse.center[1]
              ) <
              step * 0.5
          )
          if (duplicate >= 0) {
            if (seeds[duplicate].score >= score) {
              continue
            }
            seeds.splice(duplicate, 1)
          }
        }
        seeds.push({ ellipse, score })
        seeds.sort((a, b) => b.score - a.score)
        if (seeds.length > 3) {
          seeds.pop()
        }
      }
    }
  }
  let profileAttempts = 0
  for (const seed of seeds) {
    if (profileAttempts >= 3) {
      break
    }
    profileAttempts++
    let tracked = trackPupilRim(
      cv,
      gray,
      width,
      height,
      seed.ellipse,
      anchor,
      !!identity,
      null,
      identity
    )
    if (!tracked) {
      continue
    }
    if (
      requireFullEvidence &&
      tracked.shapeObserved === false &&
      profileAttempts < 3
    ) {
      // The grid only approximates pose. Reprofile from the observed center and
      // scale before testing a free shape, sharing the same three-attempt budget.
      profileAttempts++
      const refined = trackPupilRim(
        cv,
        gray,
        width,
        height,
        tracked.ellipse,
        anchor,
        !!identity,
        null,
        identity
      )
      if (refined) {
        tracked = refined
      }
    }
    if (
      identity &&
      (!compatiblePupilScale(tracked.ellipse, anchor, true) ||
        tracked.ellipse.major < identity.reference.major * 0.7 ||
        tracked.ellipse.major > identity.reference.major * 1.4)
    ) {
      continue
    }
    const appearance = pupilContrast(gray, width, height, tracked.ellipse)
    if (
      requireFullEvidence &&
      (tracked.shapeObserved === false ||
        !strongPupilEvidence(
          tracked.ellipse,
          appearance,
          boundaryEvidence(
            gray,
            width,
            height,
            tracked.ellipse,
            appearance.reflectionLimit
          )
        ))
    ) {
      continue
    }
    // A translated historical shape can match an iris arc after a saccade.
    // Its core must still resemble the independently observed dark pupil.
    if (
      (identity && tracked.shapeObserved === false) ||
      (appearance.contrast >= 8 &&
        (tracked.shapeObserved !== false ||
          appearance.interior - patch.value <=
            Math.max(20, appearance.contrast * 0.5)))
    ) {
      return tracked
    }
  }
  return null
}
export function isContinuousPupil(
  candidate: Ellipse,
  previous: Ellipse,
  width: number,
  height: number
): boolean {
  const distance = Math.hypot(
    candidate.center[0] - previous.center[0],
    candidate.center[1] - previous.center[1]
  )
  return (
    distance <= Math.max(previous.major * 2, Math.min(width, height) * 0.18) &&
    candidate.major / previous.major >= 0.6 &&
    candidate.major / previous.major <= 1.6 &&
    candidate.minor / previous.minor >= 0.45 &&
    candidate.minor / previous.minor <= 2.2
  )
}
/** Fit remaining rim arcs without treating a reflection's inward notch as pupil boundary. */
function recoverPupilRim(
  cv: CV,
  points: Point[],
  refined: Point[],
  initial: Ellipse,
  area: number,
  width: number,
  height: number,
  gray: Uint8Array,
  allowOcclusion: boolean
): Ellipse | null {
  const fit = (sample: Point[]): Ellipse | null => {
    if (sample.length < 6) {
      return null
    }
    const mat = cv.matFromArray(sample.length, 1, cv.CV_32FC2, sample.flat())
    try {
      const ellipse = convertEllipse(cv.fitEllipse(mat))
      return validEllipse(ellipse, width, height) ? ellipse : null
    } finally {
      mat.delete()
    }
  }
  const support = (ellipse: Ellipse) => {
    const tolerance = Math.max(1.5, ellipse.minor * 0.045)
    const inliers = points.filter((p) => edgeError(p, ellipse) <= tolerance)
    // Counting angular sectors prevents a long reflection edge from dominating the fit.
    const sectors = new Set<number>()
    const c = Math.cos(ellipse.angle)
    const s = Math.sin(ellipse.angle)
    for (const [x, y] of inliers) {
      const dx = x - ellipse.center[0]
      const dy = y - ellipse.center[1]
      const angle = Math.atan2(
        (-s * dx + c * dy) / ellipse.minor,
        (c * dx + s * dy) / ellipse.major
      )
      sectors.add(Math.min(31, Math.floor(((angle + Math.PI) * 16) / Math.PI)))
    }
    const fill = area / (Math.PI * ellipse.major * ellipse.minor)
    const boundary = boundaryEvidence(gray, width, height, ellipse)
    // Separated visible arcs and real dark-to-light edges must support reconstruction.
    // A merged eyelid invalidates filled-area ratios, but cannot create missing rim evidence.
    if (sectors.size < 20 || boundary.support < 0.625 || inliers.length < 12) {
      return null
    }
    if (
      !allowOcclusion &&
      (fill < 0.75 || fill > 1.15 || inliers.length < points.length * 0.55)
    ) {
      return null
    }
    const coverage = Math.min(sectors.size / 32, boundary.support)
    const confidence = allowOcclusion
      ? Math.min(0.99, 0.5 + 0.5 * coverage)
      : Math.min(1, fill, sectors.size / 32, 0.5 + 0.5 * boundary.support)
    return {
      ellipse: { ...ellipse, confidence },
      inliers,
      score: confidence + (0.05 * inliers.length) / points.length,
    }
  }
  let best = validEllipse(initial, width, height) ? support(initial) : null
  let seed = 1729
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  // Deterministic, stratified trials cover the contour without relying on one unbroken arc.
  for (let trial = 0; trial < recoveryTrials; trial++) {
    const sample = Array.from(
      { length: 8 },
      (_, i) =>
        refined[
          Math.min(
            refined.length - 1,
            Math.floor(((i + random()) * refined.length) / 8)
          )
        ]
    )
    const ellipse = fit(sample)
    if (!ellipse) {
      continue
    }
    const candidate = support(ellipse)
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate
    }
  }
  if (!best) {
    return null
  }
  const refitted = fit(best.inliers)
  const candidate = refitted && support(refitted)
  if (candidate && candidate.score >= best.score) {
    best = candidate
  }
  return best.ellipse
}
/** Between-class variance gives a second intensity estimate when a lash is darkest. */
function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Uint32Array(256)
  let total = 0
  for (const value of gray) {
    histogram[value]++
    total += value
  }
  let count = 0
  let sum = 0
  let best = -1
  let threshold = 0
  for (let value = 0; value < 255; value++) {
    count += histogram[value]
    sum += value * histogram[value]
    if (!count || count === gray.length) {
      continue
    }
    const difference = sum / count - (total - sum) / (gray.length - count)
    const variance = count * (gray.length - count) * difference ** 2
    if (variance > best) {
      best = variance
      threshold = value
    }
  }
  return threshold
}
/** PuReST's area-based intensity estimate, restricted to the previous pupil's neighborhood. */
function trackedThreshold(
  gray: Uint8Array,
  width: number,
  height: number,
  previous: Ellipse
): number {
  const histogram = new Uint32Array(256)
  const radius = previous.major * 1.5
  const left = Math.max(0, Math.floor(previous.center[0] - radius))
  const right = Math.min(width, Math.ceil(previous.center[0] + radius))
  const top = Math.max(0, Math.floor(previous.center[1] - radius))
  const bottom = Math.min(height, Math.ceil(previous.center[1] + radius))
  const area = Math.min(
    (right - left) * (bottom - top) * 0.4,
    Math.PI * previous.major * previous.minor
  )
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      histogram[gray[y * width + x]]++
    }
  }
  let count = 0
  for (let intensity = 0; intensity < 256; intensity++) {
    count += histogram[intensity]
    if (count >= area) {
      return intensity
    }
  }
  return 255
}
function pupilContrast(
  gray: Uint8Array,
  width: number,
  height: number,
  e: Ellipse
) {
  let inside = 0
  let outside = 0
  let ni = 0
  let no = 0
  const interior = new Uint32Array(256)
  const exteriorHistogram = new Uint32Array(256)
  const central = new Uint32Array(256)
  const annular = new Uint32Array(256)
  const c = Math.cos(e.angle)
  const s = Math.sin(e.angle)
  const step = Math.max(1, Math.floor(e.minor / 8))
  const r = Math.ceil(e.major * 1.65)
  for (
    let y = Math.max(0, Math.floor(e.center[1] - r));
    y < Math.min(height, e.center[1] + r);
    y += step
  ) {
    for (
      let x = Math.max(0, Math.floor(e.center[0] - r));
      x < Math.min(width, e.center[0] + r);
      x += step
    ) {
      const dx = x - e.center[0]
      const dy = y - e.center[1]
      const q =
        ((c * dx + s * dy) / e.major) ** 2 + ((-s * dx + c * dy) / e.minor) ** 2
      if (q < 0.64) {
        const index = y * width + x
        inside += gray[index]
        interior[gray[index]]++
        if (q < 0.16) {
          central[gray[index]]++
        } else if (q > 0.25) {
          annular[gray[index]]++
        }
        ni++
      } else if (q > 1.15 ** 2 && q < 1.65 ** 2) {
        outside += gray[y * width + x]
        exteriorHistogram[gray[y * width + x]]++
        no++
      }
    }
  }
  if (!ni || !no) {
    return {
      contrast: 0,
      homogeneity: 0,
      cutoff: 0,
      interior: 255,
      pupilIntensity: undefined,
      pupilIntensityLow: undefined,
      coreCutoff: null,
      reflectionLimit: 255,
    }
  }
  // Glints can cover more than the upper intensity quintile. Exclude pixels
  // brighter than the surrounding iris, while requiring a substantial dark core.
  const exterior = outside / no
  // Glints can cover more than the upper intensity quintile. Exclude pixels
  // brighter than the surrounding iris, while requiring a substantial dark core.
  const limit = Math.min(255, Math.ceil(exterior))
  let coreCount = 0
  let coreSum = 0
  for (let value = 0; value < limit; value++) {
    coreCount += interior[value]
    coreSum += value * interior[value]
  }
  if (coreCount < ni * 0.5) {
    return {
      contrast: 0,
      homogeneity: 0,
      cutoff: 0,
      interior: 255,
      pupilIntensity: undefined,
      pupilIntensityLow: undefined,
      coreCutoff: null,
      reflectionLimit: 255,
    }
  }
  inside = coreSum / coreCount
  let count = 0
  let low = -1
  let high = 255
  for (let value = 0; value < limit; value++) {
    count += interior[value]
    if (low < 0 && count >= coreCount * 0.2) {
      low = value
    }
    if (count >= coreCount * 0.8) {
      high = value
      break
    }
  }
  const quantile = (histogram: Uint32Array) => {
    let total = 0
    let cumulative = 0
    for (let value = 0; value < limit; value++) {
      total += histogram[value]
    }
    if (total < 8) {
      return null
    }
    for (let value = 0; value < limit; value++) {
      cumulative += histogram[value]
      if (cumulative >= total * 0.35) {
        return value
      }
    }
    return null
  }
  const centerLevel = quantile(central)
  const ringLevel = quantile(annular)
  const coreCutoff =
    centerLevel !== null && ringLevel !== null && ringLevel - centerLevel >= 6
      ? Math.round(centerLevel + Math.min(8, (ringLevel - centerLevel) * 0.25))
      : null
  let exteriorCount = 0
  let brightExterior = 255
  for (let value = 0; value < 256; value++) {
    exteriorCount += exteriorHistogram[value]
    if (exteriorCount >= no * 0.85) {
      brightExterior = value
      break
    }
  }
  // Glint-excluded intensity spread penalizes a textured iris around a darker pupil.
  return {
    contrast: exterior - inside,
    homogeneity: 1 / (1 + (high - low) / 35),
    cutoff: Math.round((inside + exterior) / 2),
    interior: inside,
    pupilIntensity: quantile(interior) ?? undefined,
    pupilIntensityLow: low,
    coreCutoff,
    reflectionLimit:
      brightExterior >= 250
        ? 256
        : Math.min(
            255,
            brightExterior +
              Math.max(
                20,
                Math.min(brightExterior * 0.7, (255 - brightExterior) * 0.35)
              )
          ),
  }
}
function strongPupilEvidence(
  ellipse: Ellipse,
  appearance: ReturnType<typeof pupilContrast>,
  boundary: PupilBoundaryEvidence
): boolean {
  return (
    ellipse.confidence >= 0.85 &&
    boundary.support >= 0.75 &&
    appearance.contrast >= 12 &&
    appearance.homogeneity >= 0.6 &&
    appearance.coreCutoff === null
  )
}
/** Correct a scale-matched iris seed using independently observed darker pupil evidence. */
function pupilOutlineSeed(
  gray: Uint8Array,
  width: number,
  height: number,
  scaleSeed: Ellipse | null,
  coreSeed: Ellipse | null
): Ellipse | null {
  if (
    !scaleSeed ||
    !coreSeed ||
    coreSeed.major >= scaleSeed.major * 0.7 ||
    normalizedRadius(coreSeed.center, scaleSeed) >= 0.75
  ) {
    return scaleSeed
  }
  const outer = pupilContrast(gray, width, height, scaleSeed)
  const inner = pupilContrast(gray, width, height, coreSeed)
  return outer.coreCutoff !== null &&
    outer.homogeneity < 0.6 &&
    inner.coreCutoff === null &&
    outer.interior - inner.interior >= 6 &&
    boundaryEvidence(gray, width, height, coreSeed, inner.reflectionLimit)
      .support >= 0.75
    ? coreSeed
    : scaleSeed
}
function rimMask(points: Point[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (const [x, y] of points) {
    const ix = Math.round(x)
    const iy = Math.round(y)
    if (ix >= 0 && iy >= 0 && ix < width && iy < height) {
      mask[iy * width + ix] = 255
    }
  }
  return mask
}
export function detectSpatialPupil(
  cv: CV,
  gray: Uint8Array,
  width: number,
  height: number,
  thresholdOffset: number,
  options: PupilDetectionOptions = {}
): Detection {
  const result: Detection = {
    ellipse: null,
    seed: null,
    contour: [],
    refined: [],
    previews: [],
    selected: -1,
    reason: "Pupil not found",
  }
  if (width < 24 || height < 24 || gray.length !== width * height) {
    return { ...result, reason: "Select a larger eye region" }
  }
  const manual = options.thresholdMode === "manual"
  const partialReference =
    !manual &&
    options.trackingAnchorConfirmed &&
    options.previous &&
    (options.previousShapeAgeMs ?? 0) > 200 &&
    (options.previousShapeAgeMs ?? 0) > (options.previousAgeMs ?? 0) &&
    (options.previousAgeMs ?? 0) <= 750
      ? options.previous
      : null
  const partialPatch = partialReference
    ? darkestPatch(gray, width, height, 0, options.centerRegion)
    : null
  const partialAppearance = partialReference
    ? pupilContrast(gray, width, height, partialReference)
    : null
  // Only an independently supported complete current rim may refresh exposure.
  // A cap hidden beneath the lid must retain the last full-rim glare ceiling.
  const currentFullAppearance = (() => {
    if (
      !partialReference ||
      !partialAppearance ||
      partialAppearance.contrast < 12 ||
      partialAppearance.homogeneity < 0.6 ||
      partialAppearance.coreCutoff !== null
    ) {
      return null
    }
    if (
      boundaryEvidence(
        gray,
        width,
        height,
        partialReference,
        partialAppearance.reflectionLimit
      ).support >= 0.75
    ) {
      return partialAppearance
    }
    if (
      partialAppearance.reflectionLimit <= (options.pupilReflectionLimit ?? 255)
    ) {
      return null
    }
    // Exposure and eye movement can occur together. Allow one bounded profile
    // with current brightness, requiring a full rim that preserves both axes.
    const refreshed = trackPupilRim(
      cv,
      gray,
      width,
      height,
      partialReference,
      options.trackingAnchor ?? partialReference,
      false,
      null,
      {
        minimumIntensity: Math.max(
          0,
          (partialAppearance.pupilIntensityLow ?? 0) - 8
        ),
        maximumIntensity: Math.min(
          255,
          (partialAppearance.pupilIntensity ?? 0) + 16
        ),
        reflectionLimit: partialAppearance.reflectionLimit,
        reference: partialReference,
      }
    )
    if (!refreshed || refreshed.shapeObserved === false) {
      return null
    }
    const ellipse = refreshed.ellipse
    if (
      ellipse.major / partialReference.major < 0.9 ||
      ellipse.major / partialReference.major > 1.15 ||
      ellipse.minor / partialReference.minor < 0.9 ||
      ellipse.minor / partialReference.minor > 1.15
    ) {
      return null
    }
    const appearance = pupilContrast(gray, width, height, ellipse)
    return strongPupilEvidence(
      ellipse,
      appearance,
      boundaryEvidence(gray, width, height, ellipse, appearance.reflectionLimit)
    )
      ? appearance
      : null
  })()
  const learnedIntensity =
    options.pupilIntensity !== undefined &&
    Number.isFinite(options.pupilIntensity)
      ? options.pupilIntensity
      : undefined
  const currentIntensity =
    currentFullAppearance?.pupilIntensity ?? learnedIntensity
  let lowerIntensity =
    currentFullAppearance?.pupilIntensityLow ??
    currentIntensity ??
    partialPatch?.value ??
    0
  if (
    !currentFullAppearance &&
    options.pupilIntensityLow !== undefined &&
    Number.isFinite(options.pupilIntensityLow)
  ) {
    lowerIntensity = options.pupilIntensityLow
  }
  let identity: PupilRimIdentity | null = null
  if (partialReference && partialPatch) {
    identity = {
      minimumIntensity: Math.max(0, lowerIntensity - 8),
      maximumIntensity: Math.min(
        255,
        currentIntensity !== undefined
          ? currentIntensity + 16
          : partialPatch.value + 25
      ),
      // A partially covered interior can no longer estimate iris brightness.
      // Retain its accepted full-rim glare ceiling instead of admitting the lid.
      reflectionLimit:
        currentFullAppearance?.reflectionLimit ??
        options.pupilReflectionLimit ??
        partialAppearance!.reflectionLimit,
      reference: partialReference,
    }
  }
  const withinBounds = (ellipse: Ellipse) =>
    (options.centerRegion === undefined ||
      pointInPolygon(ellipse.center, options.centerRegion)) &&
    (options.maxRadius === undefined || ellipse.major <= options.maxRadius) &&
    (options.expectedCenter === undefined ||
      options.centerRadius === undefined ||
      Math.hypot(
        ellipse.center[0] - options.expectedCenter[0],
        ellipse.center[1] - options.expectedCenter[1]
      ) <= options.centerRadius)
  const compatibleScale = (ellipse: Ellipse) =>
    manual ||
    compatiblePupilScale(
      ellipse,
      options.trackingAnchor,
      options.trackingAnchorConfirmed
    )
  const compatibleAppearance = (
    ellipse: Ellipse,
    appearance: ReturnType<typeof pupilContrast>
  ) =>
    manual ||
    !options.trackingAnchorConfirmed ||
    !options.trackingAnchor ||
    ellipse.major <= options.trackingAnchor.major * 1.1 ||
    appearance.coreCutoff === null ||
    appearance.homogeneity >= 0.6
  const trackedResult = (tracked: PupilCandidate): Detection => {
    const mask =
      options.includePreviewMasks !== false
        ? rimMask(tracked.refined, width, height)
        : undefined
    const appearance = pupilContrast(gray, width, height, tracked.ellipse)
    return {
      ...result,
      fullShapeSearched: result.fullShapeSearched ?? false,
      shapeObserved: tracked.shapeObserved !== false,
      pupilIntensity:
        tracked.shapeObserved !== false ? appearance.pupilIntensity : undefined,
      pupilIntensityLow:
        tracked.shapeObserved !== false
          ? appearance.pupilIntensityLow
          : undefined,
      pupilReflectionLimit:
        tracked.shapeObserved !== false
          ? appearance.reflectionLimit
          : undefined,
      strongEvidence:
        tracked.shapeObserved !== false &&
        strongPupilEvidence(
          tracked.ellipse,
          appearance,
          boundaryEvidence(
            gray,
            width,
            height,
            tracked.ellipse,
            identity?.reflectionLimit ?? appearance.reflectionLimit
          )
        ),
      ellipse: tracked.ellipse,
      seed: tracked.ellipse.center,
      contour: tracked.points,
      refined: tracked.refined,
      selected: 0,
      previews: [
        {
          label: "Tracked rim",
          method: "tracking",
          threshold: appearance.cutoff,
          score: tracked.ellipse.confidence,
          ...(mask ? { mask } : {}),
        },
      ],
      reason: "Pupil found",
    }
  }
  const recent =
    !manual && options.previous && (options.previousAgeMs ?? 0) <= 150
      ? options.previous
      : null
  const canRetainShape = (options.previousShapeAgeMs ?? 0) <= 200 || !!identity
  let weakTracked: PupilCandidate | null = null
  if (recent) {
    const tracked = trackPupilRim(
      cv,
      gray,
      width,
      height,
      recent,
      options.trackingAnchor ?? recent,
      false,
      null,
      identity
    )
    if (
      tracked &&
      withinBounds(tracked.ellipse) &&
      compatibleScale(tracked.ellipse) &&
      (tracked.shapeObserved !== false || canRetainShape)
    ) {
      const appearance = pupilContrast(gray, width, height, tracked.ellipse)
      if (compatibleAppearance(tracked.ellipse, appearance)) {
        if (
          identity &&
          tracked.shapeObserved === false &&
          tracked.ellipse.confidence >= maxPartialConfidence &&
          !options.refreshShape
        ) {
          return trackedResult(tracked)
        }
        if (
          tracked.shapeObserved !== false &&
          appearance.contrast >= 16 &&
          (appearance.coreCutoff === null || options.trackingAnchorConfirmed)
        ) {
          return trackedResult(tracked)
        }
        // Keep a weak fresh measurement available while stronger image evidence competes.
        tracked.score =
          (tracked.ellipse.confidence *
            (0.55 + 0.45 * Math.min(1, appearance.contrast / 60)) *
            appearance.homogeneity +
            0.12) *
          Math.log1p(Math.PI * tracked.ellipse.major * tracked.ellipse.minor)
        weakTracked = tracked
      }
    }
  }
  const patch =
    partialPatch ?? darkestPatch(gray, width, height, 0, options.centerRegion)
  if (!patch) {
    return result
  }
  result.seed = patch.point
  // Prefer the observed dark core without ruling out a pupil brighter than a lash
  // or the dark end of an illumination gradient.
  const coreSimilarity = (interior: number) =>
    0.3 + 0.7 / (1 + (Math.max(0, interior - patch.value) / 15) ** 2)
  const scaleSimilarity = (ellipse: Ellipse) =>
    !manual && options.trackingAnchorConfirmed && options.trackingAnchor
      ? 0.25 +
        0.75 *
          Math.exp(
            -3 *
              Math.abs(Math.log(ellipse.major / options.trackingAnchor.major))
          )
      : 1
  if (weakTracked) {
    weakTracked.score *=
      scaleSimilarity(weakTracked.ellipse) *
      coreSimilarity(
        pupilContrast(gray, width, height, weakTracked.ellipse).interior
      )
  }
  const cutoff = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value)))
  const otsu = manual ? 0 : otsuThreshold(gray)
  // Black padding can be much darker than the pupil.
  // Keep the strict hypotheses, then search the brighter scene population.
  const foregroundPatch =
    !manual && patch.value < otsu * 0.3 && hasBlackPadding(gray, width, height)
      ? darkestPatch(gray, width, height, otsu + 1, options.centerRegion)
      : null
  const foregroundThreshold = foregroundPatch
    ? foregroundPatch.value + 30
    : Math.max(patch.value + 35, otsu * 0.8)
  const globalThresholds = manual
    ? [cutoff(thresholdOffset)]
    : [
        patch.value + 15,
        Math.max(patch.value + 25, otsu * 0.55),
        foregroundThreshold,
      ].map((value) => cutoff(value + thresholdOffset))
  const canUseLocalHistory =
    !manual && options.previous && (options.previousAgeMs ?? 0) <= 150
  const estimatedThreshold = canUseLocalHistory
    ? trackedThreshold(gray, width, height, options.previous!) + thresholdOffset
    : null
  const thresholds =
    estimatedThreshold === null
      ? globalThresholds
      : [-6, 0, 6].map((delta) => cutoff(estimatedThreshold + delta))
  const owned: CvOwnedObject[] = []
  const own = <T extends CvOwnedObject>(value: T): T => {
    owned.push(value)
    return value
  }
  try {
    result.fullShapeSearched = true
    const source = own(new cv.Mat(height, width, cv.CV_8UC1))
    source.data.set(gray)
    result.previews = thresholds.map((threshold, index) => ({
      label: manual ? "Manual" : ["Strict", "Balanced", "Relaxed"][index],
      threshold,
      method: "global",
      score: 0,
    }))
    const mask = own(new cv.Mat(height, width, cv.CV_8UC1))
    const filtered = own(new cv.Mat())
    const contours = own(new cv.MatVector())
    const hierarchy = own(new cv.Mat())
    // A large crop must not imply a large erosion kernel for a tiny pupil.
    const kernelSize = options.previous
      ? Math.min(5, Math.max(1, Math.floor(options.previous.minor * 0.12) | 1))
      : 3
    const kernel = own(
      cv.getStructuringElement(
        cv.MORPH_ELLIPSE,
        new cv.Size(kernelSize, kernelSize)
      )
    )
    const proposals: PupilProposal[] = []
    let bestCandidate: PupilCandidate | null = null
    let irregular = false
    let fragmented = false
    let seedEllipse: Ellipse | null = null
    let scaleSeed: Ellipse | null = null
    let scaleSeedScore = 0
    const consider = (
      ellipse: Ellipse,
      index: number,
      points: Point[],
      refined: Point[]
    ) => {
      if (!validEllipse(ellipse, width, height) || !withinBounds(ellipse)) {
        return
      }
      const anchor = options.trackingAnchor
      // The major axis changes little during a saccade. Keep its scale through
      // a blink so a tiny iris feature cannot establish a new pupil identity.
      if (!compatibleScale(ellipse)) {
        return
      }
      const appearance = pupilContrast(gray, width, height, ellipse)
      // A brighter-scene cutoff may merge pupil and iris during acquisition.
      // Without an established identity, do not promote that enclosing outline.
      if (
        foregroundPatch &&
        !options.trackingAnchorConfirmed &&
        appearance.coreCutoff !== null
      ) {
        return
      }
      if (!compatibleAppearance(ellipse, appearance)) {
        return
      }
      const boundary = boundaryEvidence(
        gray,
        width,
        height,
        ellipse,
        identity?.reflectionLimit ?? appearance.reflectionLimit
      )
      if (boundary.support < 0.55) {
        return
      }
      const contrast = Math.max(
        appearance.contrast,
        boundary.contrast * boundary.support
      )
      if (contrast < 8 || appearance.homogeneity < 0.3) {
        return
      }
      const confidence = Math.min(
        ellipse.confidence,
        0.4 + 0.6 * boundary.support
      )
      if (confidence < 0.65) {
        return
      }
      // A nearby, weak oversized fit often follows the eyelid shadow. A new
      // location or a strongly observed rim can still establish a larger pupil.
      if (
        !manual &&
        anchor &&
        ellipse.major > anchor.major * 1.6 &&
        confidence < 0.9 &&
        Math.hypot(
          ellipse.center[0] - (options.previous ?? anchor).center[0],
          ellipse.center[1] - (options.previous ?? anchor).center[1]
        ) <
          anchor.major * 2
      ) {
        return
      }
      const fitted = { ...ellipse, confidence }
      // Validate current pupil arcs before a reflected cap can become a new
      // full-shape reference. Outward brightness must persist beyond the rim.
      if (
        identity &&
        !supportedFullPupilRim(gray, width, height, fitted, identity)
      ) {
        return
      }
      let score =
        confidence *
        (0.55 + 0.45 * Math.min(1, contrast / 60)) *
        appearance.homogeneity
      const referenceCenter = options.previous?.center ?? options.expectedCenter
      if (referenceCenter) {
        const distance = Math.hypot(
          fitted.center[0] - referenceCenter[0],
          fitted.center[1] - referenceCenter[1]
        )
        const expectedDistance = Math.max(
          options.previous?.major ?? 0,
          Math.min(width, height) * 0.1
        )
        const position = Math.exp(-0.5 * (distance / expectedDistance) ** 2)
        const size = options.previous
          ? Math.exp(-Math.abs(Math.log(fitted.major / options.previous.major)))
          : 1
        // A small preference stabilizes a track, while stronger image evidence can beat it.
        score += 0.12 * position * size
      }
      if (index === options.previousSelected) {
        score += 0.03
      }
      // Integrated rim evidence favors a whole pupil over a few dark iris pixels.
      score *= Math.log1p(Math.PI * fitted.major * fitted.minor)
      score *= coreSimilarity(appearance.interior)
      score *= scaleSimilarity(fitted)
      const seedRadius = normalizedRadius(patch.point, fitted)
      if (seedRadius > 1) {
        score *= 0.5
      }
      if (!manual && bestCandidate) {
        const other = bestCandidate.ellipse
        const smaller = fitted.major < other.major ? fitted : other
        const larger = smaller === fitted ? other : fitted
        if (smaller.major < larger.major * 0.7 && smaller.confidence >= 0.72) {
          const contained =
            normalizedRadius(smaller.center, larger) +
              smaller.major / larger.minor <
            1
          const otherAppearance = pupilContrast(gray, width, height, other)
          const smallerInterior =
            smaller === fitted ? appearance.interior : otherAppearance.interior
          const largerInterior =
            larger === fitted ? appearance.interior : otherAppearance.interior
          // An enclosing iris can have a strong outer rim. Prefer an independently
          // supported darker pupil inside it, following PuRe's nested-pupil check.
          const largerAppearance =
            larger === fitted ? appearance : otherAppearance
          if (
            contained &&
            largerAppearance.coreCutoff !== null &&
            largerInterior - smallerInterior >= 6 &&
            (!options.trackingAnchorConfirmed ||
              !anchor ||
              larger.major > anchor.major * 1.3 ||
              largerAppearance.homogeneity < 0.6)
          ) {
            if (larger === fitted) {
              return
            }
            score = Math.max(score, bestCandidate.score + 0.001)
          }
        }
      }
      result.previews[index].score = Math.max(
        result.previews[index].score,
        confidence
      )
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { score, index, points, refined, ellipse: fitted }
      }
    }
    const queueRecovery = (proposal: PupilProposal) => {
      const duplicate = proposals.findIndex(
        (other) =>
          Math.hypot(
            other.ellipse.center[0] - proposal.ellipse.center[0],
            other.ellipse.center[1] - proposal.ellipse.center[1]
          ) < 3 &&
          Math.abs(other.ellipse.major - proposal.ellipse.major) < 3 &&
          Math.abs(other.ellipse.minor - proposal.ellipse.minor) < 3
      )
      if (duplicate >= 0) {
        if (proposals[duplicate].quality >= proposal.quality) {
          return
        }
        proposals.splice(duplicate, 1)
      }
      proposals.push(proposal)
      proposals.sort((a, b) => b.quality - a.quality)
      if (proposals.length > 3) {
        proposals.pop()
      }
    }
    const findCandidates = (
      input: InstanceType<CV["Mat"]>,
      index: number,
      edgeBased = false
    ) => {
      cv.findContours(
        input,
        contours,
        hierarchy,
        edgeBased ? cv.RETR_LIST : cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_NONE
      )
      const regions: PupilContourRegion[] = []
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i)
        try {
          const area = cv.contourArea(contour)
          const box = cv.boundingRect(contour)
          if (
            contour.rows < 6 ||
            (!edgeBased && area < 20) ||
            area > width * height * 0.9 ||
            (!edgeBased &&
              Math.max(box.width / box.height, box.height / box.width) > 8)
          ) {
            continue
          }
          let priority = edgeBased
            ? Math.min(box.width, box.height) / Math.max(box.width, box.height)
            : area / (box.width * box.height)
          if (options.previous) {
            const distance = Math.hypot(
              box.x + box.width / 2 - options.previous.center[0],
              box.y + box.height / 2 - options.previous.center[1]
            )
            priority +=
              0.1 * Math.exp(-distance / Math.max(1, options.previous.major))
          }
          priority *= Math.log1p(Math.max(area, contour.rows))
          regions.push({ index: i, area, priority, bounds: box })
          regions.sort((a, b) => b.priority - a.priority)
          if (regions.length > maxContourCandidates) {
            regions.pop()
          }
        } finally {
          contour.delete()
        }
      }
      const fragments: RefinedPupilContour[] = []
      const fitContour = (
        points: Point[],
        refined: Point[],
        area: number,
        fragmentCount = 1
      ) => {
        const fitPoints = cv.matFromArray(
          refined.length,
          1,
          cv.CV_32FC2,
          refined.flat()
        )
        let fitted: Ellipse
        try {
          fitted = convertEllipse(cv.fitEllipse(fitPoints))
        } finally {
          fitPoints.delete()
        }
        if (
          !finite([
            ...fitted.center,
            fitted.major,
            fitted.minor,
            fitted.angle,
          ]) ||
          fitted.minor <= 0 ||
          !withinBounds(fitted)
        ) {
          return
        }
        const tolerance = Math.max(1.5, fitted.minor * 0.06)
        const agreement =
          points.filter((p) => edgeError(p, fitted) <= tolerance).length /
          points.length
        const fill = Math.min(1, area / (Math.PI * fitted.major * fitted.minor))
        fitted.confidence = Math.min(fill, agreement)
        if (
          !manual &&
          !edgeBased &&
          index === 0 &&
          validEllipse(fitted, width, height)
        ) {
          if (
            normalizedRadius(patch.point, fitted) < 1 &&
            (!seedEllipse || fitted.major < seedEllipse.major)
          ) {
            seedEllipse = fitted
          }
        }
        const boundary = validEllipse(fitted, width, height)
          ? boundaryEvidence(gray, width, height, fitted)
          : { support: 0, contrast: 0 }
        const anchor = options.trackingAnchor
        if (
          !manual &&
          !edgeBased &&
          anchor &&
          options.trackingAnchorConfirmed &&
          fitted.major >= anchor.major * 0.8 &&
          fitted.major <= anchor.major * 1.25 &&
          boundary.support >= 0.4
        ) {
          const containsSeed = normalizedRadius(patch.point, fitted) < 1
          const score =
            boundary.support *
            Math.exp(-Math.abs(Math.log(fitted.major / anchor.major)))
          // A glint can ruin mask fill while leaving a usable whole outline.
          // Preserve one scale-compatible seed from any of the four masks;
          // fresh signed rim measurements still have to validate the fit.
          if (containsSeed && score > scaleSeedScore) {
            scaleSeed = fitted
            scaleSeedScore = score
          }
        }
        if (!edgeBased) {
          consider(fitted, index, points, refined)
        }
        if (refined.length >= 12) {
          irregular = true
          queueRecovery({
            index,
            points,
            refined,
            ellipse: fitted,
            area,
            quality:
              (boundary.support * 0.6 +
                agreement * 0.2 +
                Math.min(1, refined.length / points.length) * 0.2) *
              Math.log1p(Math.max(area, points.length)) *
              Math.sqrt(fragmentCount) *
              (0.25 +
                0.75 * pupilContrast(gray, width, height, fitted).homogeneity),
          })
        }
      }
      for (const region of regions) {
        const contour = contours.get(region.index)
        const area = region.area
        try {
          const points: Point[] = []
          const stride = Math.max(1, Math.ceil(contour.rows / maxContourPoints))
          const coordinates = contour.data32S
          for (let j = 0; j < contour.rows; j += stride) {
            const x = coordinates[j * 2]
            const y = coordinates[j * 2 + 1]
            // The crop edge is not an observed pupil boundary. Keep the remaining arcs.
            if (x > 1 && y > 1 && x < width - 2 && y < height - 2) {
              points.push([x, y])
            }
          }
          if (points.length < 6) {
            continue
          }
          const refined = edgeBased
            ? curvedEdgePoints(points)
            : refineContour(points)
          if (refined.length < 6) {
            continue
          }
          fitContour(points, refined, area)
          if (!manual && !edgeBased) {
            fragments.push({ region, points, refined })
          }
        } finally {
          contour.delete()
        }
      }
      // Reflections can divide one pupil into disconnected masks. Combine only
      // neighboring core fragments; image evidence still validates the final rim.
      fragments.sort((a, b) => b.region.area - a.region.area)
      const fragmentMargin = (
        a: PupilContourRegion["bounds"],
        b: PupilContourRegion["bounds"]
      ) =>
        Math.max(
          3,
          Math.min(Math.max(a.width, a.height), Math.max(b.width, b.height)) *
            0.25
        )
      const nearby = (
        a: PupilContourRegion["bounds"],
        b: PupilContourRegion["bounds"]
      ) => {
        const margin = fragmentMargin(a, b)
        return (
          Math.max(a.x - b.x - b.width, b.x - a.x - a.width) <= margin &&
          Math.max(a.y - b.y - b.height, b.y - a.y - a.height) <= margin
        )
      }
      const cores = options.previous
        ? [options.previous.center, patch.point]
        : [patch.point]
      let combined = 0
      for (let i = 0; i < Math.min(8, fragments.length) && combined < 3; i++) {
        for (
          let j = i + 1;
          j < Math.min(8, fragments.length) && combined < 3;
          j++
        ) {
          const a = fragments[i]
          const b = fragments[j]
          const ab = a.region.bounds
          const bb = b.region.bounds
          const margin = fragmentMargin(ab, bb)
          const left = Math.min(ab.x, bb.x)
          const right = Math.max(ab.x + ab.width, bb.x + bb.width)
          const top = Math.min(ab.y, bb.y)
          const bottom = Math.max(ab.y + ab.height, bb.y + bb.height)
          if (
            b.region.area < a.region.area * 0.08 ||
            !nearby(ab, bb) ||
            !cores.some(
              ([x, y]) =>
                x >= left - margin &&
                x <= right + margin &&
                y >= top - margin &&
                y <= bottom + margin
            )
          ) {
            continue
          }
          combined++
          fragmented = true
          const joined = [a, b]
          for (const fragment of fragments.slice(0, 8)) {
            if (joined.length >= 4) {
              break
            }
            if (
              !joined.includes(fragment) &&
              fragment.region.area >= a.region.area * 0.08 &&
              joined.some((part) =>
                nearby(part.region.bounds, fragment.region.bounds)
              )
            ) {
              joined.push(fragment)
            }
          }
          fitContour(
            joined.flatMap((part) => part.points),
            joined.flatMap((part) => part.refined),
            joined.reduce((area, part) => area + part.region.area, 0),
            joined.length
          )
        }
      }
    }
    let recoveryAttempts = 0
    const recoverBestProposal = () => {
      if (recoveryAttempts >= 2) {
        return
      }
      const proposal = proposals.shift()
      if (!proposal) {
        return
      }
      recoveryAttempts++
      const recovered = recoverPupilRim(
        cv,
        proposal.points,
        proposal.refined,
        proposal.ellipse,
        proposal.area,
        width,
        height,
        gray,
        !manual
      )
      if (recovered) {
        consider(recovered, proposal.index, proposal.points, proposal.refined)
      }
    }
    const segment = (index: number) => {
      const maskPixels = mask.data
      const threshold = result.previews[index].threshold
      for (let i = 0; i < gray.length; i++) {
        maskPixels[i] = gray[i] <= threshold ? 255 : 0
      }
      cv.morphologyEx(mask, filtered, cv.MORPH_OPEN, kernel)
      if (options.includePreviewMasks !== false) {
        result.previews[index].mask = Uint8Array.from(filtered.data)
      }
      findCandidates(filtered, index)
    }
    const currentBest = (): PupilCandidate | null => bestCandidate
    // Outline previews do not perform segmentation. Count threshold passes,
    // so an outline refinement cannot suppress the fourth recovery mask.
    const canSegmentAgain = () =>
      result.previews.filter((preview) => preview.method === "global").length <
      4
    for (let index = 0; index < thresholds.length; index++) {
      segment(index)
      // Reconstruct dark-core arcs before broader iris masks can
      // displace them from the bounded recovery shortlist.
      if (
        index === 0 &&
        estimatedThreshold === null &&
        (fragmented ||
          !currentBest() ||
          currentBest()!.ellipse.confidence < 0.88)
      ) {
        recoverBestProposal()
      }
    }
    const broadCandidate = currentBest()
    const coreCutoff =
      broadCandidate &&
      pupilContrast(gray, width, height, broadCandidate.ellipse).coreCutoff
    // An iris can win the first masks because its outer boundary is stronger.
    // Spend the fourth mask on its darker central pupil when that structure exists.
    if (
      !manual &&
      canSegmentAgain() &&
      broadCandidate &&
      coreCutoff !== null &&
      coreCutoff !== undefined &&
      coreCutoff < thresholds[0] - 4
    ) {
      result.previews.push({
        label: "Dark core",
        threshold: cutoff(coreCutoff),
        method: "global",
        score: 0,
      })
      proposals.length = 0
      segment(result.previews.length - 1)
      recoverBestProposal()
    }
    const localCandidate = currentBest()
    const previous = options.previous
    const moved =
      previous &&
      localCandidate &&
      (!isContinuousPupil(localCandidate.ellipse, previous, width, height) ||
        Math.hypot(
          localCandidate.ellipse.center[0] - previous.center[0],
          localCandidate.ellipse.center[1] - previous.center[1]
        ) >
          previous.major * 0.75)
    if (
      !manual &&
      canSegmentAgain() &&
      ((estimatedThreshold !== null &&
        moved &&
        globalThresholds[0] < thresholds[0] - 6) ||
        !currentBest() ||
        currentBest()!.ellipse.confidence < 0.82)
    ) {
      let reacquireThreshold: number
      if (estimatedThreshold !== null) {
        const thresholdIndex =
          foregroundPatch || (!moved && localCandidate) ? 2 : 0
        reacquireThreshold = globalThresholds[thresholdIndex]
      } else {
        const foregroundIntensity = foregroundPatch
          ? foregroundPatch.value + 40
          : otsu
        reacquireThreshold = foregroundIntensity + thresholdOffset
      }
      result.previews.push({
        label: "Reacquire",
        threshold: cutoff(reacquireThreshold),
        method: "global",
        score: 0,
      })
      // A local histogram can still describe the iris after an abrupt change.
      // Preserve its three hypotheses, then compare independent dark-core evidence.
      if (estimatedThreshold !== null && moved) {
        proposals.length = 0
      }
      segment(result.previews.length - 1)
      if (estimatedThreshold !== null && moved) {
        recoverBestProposal()
      }
    }
    if (!currentBest() || currentBest()!.ellipse.confidence < 0.88) {
      recoverBestProposal()
    }
    scaleSeed = pupilOutlineSeed(gray, width, height, scaleSeed, seedEllipse)
    const recoveredCandidate = currentBest()
    const // Reflections can leave only an upper fragment in the strict mask.
      // Refine the recovered whole-pupil candidate before the smaller seed.
      outlineSeed =
        scaleSeed ??
        (recoveredCandidate &&
        options.trackingAnchorConfirmed &&
        options.trackingAnchor &&
        recoveredCandidate.ellipse.major >= options.trackingAnchor.major * 0.8
          ? recoveredCandidate.ellipse
          : seedEllipse)
    if (
      !manual &&
      outlineSeed &&
      outlineSeed.confidence >= 0.1 &&
      (!recoveredCandidate ||
        recoveredCandidate.ellipse.confidence < 0.9 ||
        pupilContrast(gray, width, height, recoveredCandidate.ellipse)
          .coreCutoff !== null)
    ) {
      const outlined = trackPupilRim(
        cv,
        gray,
        width,
        height,
        outlineSeed,
        options.trackingAnchor ?? outlineSeed,
        true,
        recent
      )
      if (outlined && outlined.shapeObserved !== false) {
        const index = result.previews.length
        result.previews.push({
          label: "Rim recovery",
          threshold: globalThresholds[0],
          method: "edges",
          score: 0,
          ...(options.includePreviewMasks !== false
            ? { mask: rimMask(outlined.refined, width, height) }
            : {}),
        })
        consider(outlined.ellipse, index, outlined.points, outlined.refined)
      }
    }
    if (
      (recent || partialReference) &&
      (!weakTracked ||
        !identity ||
        weakTracked.ellipse.confidence < maxPartialConfidence) &&
      (!currentBest() || currentBest()!.ellipse.confidence < 0.72)
    ) {
      const relocated = relocatePupilRim(
        cv,
        gray,
        width,
        height,
        (recent ?? partialReference)!,
        options.trackingAnchor ?? (recent ?? partialReference)!,
        patch,
        identity,
        !!identity && weakTracked?.shapeObserved === false
      )
      if (
        relocated &&
        withinBounds(relocated.ellipse) &&
        compatibleScale(relocated.ellipse) &&
        compatibleAppearance(
          relocated.ellipse,
          pupilContrast(gray, width, height, relocated.ellipse)
        ) &&
        (relocated.shapeObserved !== false || canRetainShape)
      ) {
        return trackedResult(relocated)
      }
    }
    if (
      !manual &&
      recoveryAttempts < 2 &&
      (!currentBest() || currentBest()!.ellipse.confidence < 0.82)
    ) {
      // At most one extra edge pass and one more robust fit; no unbounded threshold search.
      cv.GaussianBlur(source, filtered, new cv.Size(3, 3), 0)
      cv.Canny(filtered, mask, 12, 36, 3, true)
      const index = result.previews.length
      result.previews.push({
        label: "Edge recovery",
        threshold: thresholds[0],
        method: "edges",
        score: 0,
        ...(options.includePreviewMasks !== false
          ? { mask: Uint8Array.from(mask.data) }
          : {}),
      })
      proposals.length = 0
      findCandidates(mask, index, true)
      recoverBestProposal()
    }
    const winner = currentBest()
    if (
      weakTracked?.shapeObserved === false &&
      (identity || options.trackingAnchorConfirmed)
    ) {
      const appearance =
        winner && pupilContrast(gray, width, height, winner.ellipse)
      if (
        !winner ||
        !appearance ||
        !strongPupilEvidence(
          winner.ellipse,
          appearance,
          boundaryEvidence(
            gray,
            width,
            height,
            winner.ellipse,
            identity?.reflectionLimit ?? appearance.reflectionLimit
          )
        )
      ) {
        return trackedResult(weakTracked)
      }
      // A strong full measurement refreshes shape and brightness even when
      // the partial fit's historical size gives it a higher ranking score.
      weakTracked = null
    }
    if (weakTracked && (!winner || weakTracked.score >= winner.score)) {
      return trackedResult(weakTracked)
    }
    if (winner) {
      result.selected = winner.index
      result.contour = winner.points
      result.refined = winner.refined
      result.ellipse = winner.ellipse
      const appearance = pupilContrast(gray, width, height, winner.ellipse)
      const boundary = boundaryEvidence(
        gray,
        width,
        height,
        winner.ellipse,
        identity?.reflectionLimit ?? appearance.reflectionLimit
      )
      result.strongEvidence =
        !manual && strongPupilEvidence(winner.ellipse, appearance, boundary)
      result.pupilIntensity = appearance.pupilIntensity
      result.pupilIntensityLow = appearance.pupilIntensityLow
      result.pupilReflectionLimit = appearance.reflectionLimit
      const preview = result.previews[winner.index]
      if (preview.method === "edges") {
        preview.threshold = pupilContrast(
          gray,
          width,
          height,
          winner.ellipse
        ).cutoff
      }
      result.reason =
        winner.ellipse.confidence >= 0.82 ? "Pupil found" : "Pupil fit is weak"
    } else {
      const previous = options.previousSelected
      result.selected =
        previous !== undefined &&
        previous >= 0 &&
        previous < result.previews.length
          ? previous
          : 0
      if (irregular) {
        result.reason =
          "Pupil boundary obscured \u00B7 adjust the eye region or lighting"
      }
    }
    return result
  } finally {
    for (let i = owned.length - 1; i >= 0; i--) {
      owned[i].delete()
    }
  }
}
