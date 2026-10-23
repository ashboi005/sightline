import type { Point } from "../eye-tracking/eye-tracking.types"
import type { CV } from "../eye-tracking/opencv.types"
import type {
  Candidate,
  Ellipse,
  MarkerImage,
  MarkerObservation,
} from "./marker-detector.types"
import type { SceneObservation } from "./scene.types"
export type { MarkerImage, MarkerObservation } from "./marker-detector.types"
/** Broad bands survive blur; the red fixation dot stays inside the black disc. */
export function markerSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="42" fill="black"/><circle cx="50" cy="50" r="26" fill="white"/><circle cx="50" cy="50" r="11" fill="black"/><circle cx="50" cy="50" r="1.5" fill="#e11d48"/></svg>'
}
const area = (e: Ellipse) => Math.PI * e.rx * e.ry
function pixel(e: Ellipse, radius: number, angle: number): Point {
  const x = e.rx * radius * Math.cos(angle)
  const y = e.ry * radius * Math.sin(angle)
  return [
    e.x + x * Math.cos(e.angle) - y * Math.sin(e.angle),
    e.y + x * Math.sin(e.angle) + y * Math.cos(e.angle),
  ]
}
/** Nested ellipse geometry plus local contrast, following the circle-marker
 * approach used by Pupil Core. Every result is measured from this frame only.
 * https://github.com/pupil-labs/pupil/blob/master/pupil_src/shared_modules/circle_detector.py
 */
export class MarkerDetector {
  private cv: CV
  private source = ""
  private referenceArea: number | null = null
  constructor(cv: CV) {
    this.cv = cv
  }
  detect(image: MarkerImage, scene: SceneObservation): MarkerObservation {
    const { cv } = this
    const { width, height, data } = image
    const source = `${scene.generation}:${width}:${height}`
    if (source !== this.source) {
      this.source = source
      this.referenceArea = null
    }
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      data.length !== width * height * 4
    ) {
      throw new Error("The scene camera returned unreadable marker pixels.")
    }
    const missing = (reason: string): MarkerObservation => ({
      scene,
      position: null,
      corners: [],
      reason,
    })
    const rgba = cv.matFromImageData(image)
    const gray = new cv.Mat()
    const smooth = new cv.Mat()
    const binary = new cv.Mat()
    const candidates: Candidate[] = []
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
      cv.GaussianBlur(gray, smooth, new cv.Size(3, 3), 0.7)
      // Global histogram handles exposure changes; local thresholds also handle
      // brightness gradients and a bright display in a dark camera image.
      for (const threshold of [null, 8, 3]) {
        if (threshold === null) {
          cv.threshold(
            smooth,
            binary,
            0,
            255,
            cv.THRESH_BINARY_INV | cv.THRESH_OTSU
          )
        } else {
          cv.adaptiveThreshold(
            smooth,
            binary,
            255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY_INV,
            61,
            threshold
          )
        }
        for (const candidate of this.findCandidates(
          binary,
          smooth,
          width,
          height
        )) {
          const duplicate = candidates.findIndex(
            ({ center, outer }) =>
              Math.hypot(
                center[0] - candidate.center[0],
                center[1] - candidate.center[1]
              ) <
              Math.min(outer.rx, outer.ry) * 0.25
          )
          if (duplicate < 0) {
            candidates.push(candidate)
          } else if (candidate.quality > candidates[duplicate].quality) {
            candidates[duplicate] = candidate
          }
        }
      }
    } finally {
      rgba.delete()
      gray.delete()
      smooth.delete()
      binary.delete()
    }
    candidates.sort((a, b) => area(b.outer) - area(a.outer))
    if (!candidates.length) {
      return missing("Marker not clear. Increase its size or reduce glare.")
    }
    // The same screen's camera preview can contain a miniature copy. Accept a
    // clearly dominant reference, but never silently choose between peers.
    if (
      candidates[1] &&
      area(candidates[0].outer) < 4 * area(candidates[1].outer)
    ) {
      return missing("Keep one large marker in view.")
    }
    const { outer, center } = candidates[0]
    const currentArea = area(outer)
    // A miniature monitor copy must not take over when the physical reference
    // is lost. Gradual distance/angle changes remain measurable; an abrupt
    // large shrink requires bringing the primary reference back into view.
    if (this.referenceArea !== null && currentArea < this.referenceArea * 0.4) {
      return missing(
        "Primary marker lost. Bring the large marker back into view."
      )
    }
    this.referenceArea = currentArea
    const corners = Array.from({ length: 32 }, (_, index): Point => {
      const [x, y] = pixel(outer, 1, (index * Math.PI) / 16)
      return [x / width, y / height]
    })
    return { scene, position: [center[0] / width, center[1] / height], corners }
  }
  private findCandidates(
    binary: InstanceType<CV["Mat"]>,
    gray: InstanceType<CV["Mat"]>,
    width: number,
    height: number
  ): Candidate[] {
    const { cv } = this
    const contours = new cv.MatVector()
    const hierarchy = new cv.Mat()
    const candidates: Candidate[] = []
    const fitted = new Map<number, Ellipse | null>()
    try {
      cv.findContours(
        binary,
        contours,
        hierarchy,
        cv.RETR_TREE,
        cv.CHAIN_APPROX_NONE
      )
      const fit = (index: number): Ellipse | null => {
        if (fitted.has(index)) {
          return fitted.get(index)!
        }
        const contour = contours.get(index)
        let result: Ellipse | null = null
        try {
          if (contour.rows < 5 || Math.abs(cv.contourArea(contour)) < 18) {
            return null
          }
          const ellipse = cv.fitEllipse(contour)
          const e: Ellipse = {
            x: ellipse.center.x,
            y: ellipse.center.y,
            rx: ellipse.size.width / 2,
            ry: ellipse.size.height / 2,
            angle: (ellipse.angle * Math.PI) / 180,
            error: 0,
          }
          if (
            ![e.x, e.y, e.rx, e.ry, e.angle].every(Number.isFinite) ||
            Math.min(e.rx, e.ry) < 2 ||
            Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry) < 0.25
          ) {
            return null
          }
          const fill = Math.abs(cv.contourArea(contour)) / area(e)
          if (fill < 0.8 || fill > 1.2) {
            return null
          }
          const cos = Math.cos(e.angle)
          const sin = Math.sin(e.angle)
          for (let i = 0; i < contour.data32S.length; i += 2) {
            const dx = contour.data32S[i] - e.x
            const dy = contour.data32S[i + 1] - e.y
            e.error += Math.abs(
              Math.hypot(
                (dx * cos + dy * sin) / e.rx,
                (-dx * sin + dy * cos) / e.ry
              ) - 1
            )
          }
          e.error /= contour.rows
          if (e.error <= 0.08) {
            result = e
          }
          return result
        } finally {
          contour.delete()
          fitted.set(index, result)
        }
      }
      // Only immediate contour children are eligible: a ring, its white hole,
      // then a black disc. This rejects ordinary circles and disconnected blobs.
      for (let index = 0; index < contours.size(); index++) {
        const holeIndex = hierarchy.data32S[index * 4 + 2]
        if (holeIndex < 0) {
          continue
        }
        const dotIndex = hierarchy.data32S[holeIndex * 4 + 2]
        if (dotIndex < 0) {
          continue
        }
        const outer = fit(index)
        const hole = fit(holeIndex)
        const dot = fit(dotIndex)
        if (!outer || !hole || !dot || Math.min(outer.rx, outer.ry) < 14) {
          continue
        }
        const holeRatio = Math.sqrt(area(hole) / area(outer))
        const dotRatio = Math.sqrt(area(dot) / area(outer))
        if (
          holeRatio < 0.5 ||
          holeRatio > 0.77 ||
          dotRatio < 0.18 ||
          dotRatio > 0.37
        ) {
          continue
        }
        const distance = (e: Ellipse) =>
          Math.hypot(e.x - outer.x, e.y - outer.y)
        // Perspective shifts the fitted centers of concentric physical circles.
        // The small central disc shifts least; do not force identical centers.
        if (
          distance(hole) > Math.min(outer.rx, outer.ry) * 0.3 ||
          distance(dot) > Math.min(outer.rx, outer.ry) * 0.35
        ) {
          continue
        }
        let valid = 0
        let contrast = 0
        for (let sample = 0; sample < 24; sample++) {
          const angle = (sample * Math.PI) / 12
          const read = (ellipse: Ellipse, radius: number) => {
            const [x, y] = pixel(ellipse, radius, angle)
            const ix = Math.round(x)
            const iy = Math.round(y)
            return ix < 0 || iy < 0 || ix >= width || iy >= height
              ? null
              : gray.data[iy * width + ix]
          }
          const ring = read(outer, 0.84)
          const middle = read(hole, 0.74)
          const outside = read(outer, 1.1)
          const center = read(dot, 0.4)
          if (
            ring === null ||
            middle === null ||
            outside === null ||
            center === null
          ) {
            valid = 0
            break
          }
          const difference = Math.min(
            middle - ring,
            outside - ring,
            middle - center
          )
          if (difference >= 18) {
            valid++
          }
          contrast += difference
        }
        if (valid >= 21) {
          candidates.push({
            outer,
            center: [dot.x, dot.y],
            quality: contrast / 24 - 50 * (outer.error + dot.error),
          })
        }
      }
      return candidates
    } finally {
      contours.delete()
      hierarchy.delete()
    }
  }
}
