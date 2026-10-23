import { gazeVector3D } from "./manual-gaze-vector"
import { createManualEyeModel, EyeModelEstimator } from "./eye-model"
import { EyeSlippageTracker } from "./eye-slippage"
import type {
  Detection,
  EyeModel,
  FrameSettings,
  Gaze,
  Point,
  TrackingFrame,
} from "./eye-tracking.types"
import {
  cameraIntrinsics,
  gazeFromPupil,
  sphereFromProjection,
} from "./geometry"
import type { CV } from "./opencv.types"
import { PupilTracker } from "./pupil-tracker"
export class TrackingEngine {
  private readonly model = new EyeModelEstimator()
  private readonly slippage = new EyeSlippageTracker()
  private configKey = ""
  private readonly pupils: PupilTracker
  private gray = new Uint8Array(0)
  constructor(privateCv: CV) {
    this.pupils = new PupilTracker(privateCv)
  }
  reset() {
    this.model.reset()
    this.slippage.reset()
    this.configKey = ""
    this.pupils.reset()
  }
  process(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    settings: FrameSettings,
    id: number,
    timestamp: number,
    includePreviewMasks = true
  ): TrackingFrame {
    const start = performance.now()
    const roi = settings.roi
    if (
      ![width, height, roi.x, roi.y, roi.width, roi.height].every(
        Number.isInteger
      ) ||
      roi.x < 0 ||
      roi.y < 0 ||
      roi.width < 1 ||
      roi.height < 1 ||
      roi.x + roi.width > width ||
      roi.y + roi.height > height ||
      rgba.length !== width * height * 4
    ) {
      throw new Error("Invalid camera frame or eye region.")
    }
    const key = JSON.stringify([
      width,
      height,
      settings.format,
      roi,
      settings.threshold,
      settings.thresholdMode,
      settings.fov,
      settings.radiusMm,
      settings.corners,
    ])
    if (key !== this.configKey) {
      this.reset()
      this.configKey = key
    }
    if (this.gray.length !== roi.width * roi.height) {
      this.gray = new Uint8Array(roi.width * roi.height)
    }
    const gray = this.gray
    // Crop and convert directly into a reusable buffer, without an intermediate RGBA crop.
    for (let y = 0; y < roi.height; y++) {
      let source = ((y + roi.y) * width + roi.x) * 4
      const row = y * roi.width
      for (let x = 0; x < roi.width; x++) {
        gray[row + x] = Math.round(
          rgba[source] * 0.299 +
            rgba[source + 1] * 0.587 +
            rgba[source + 2] * 0.114
        )
        source += 4
      }
    }
    let detection: Detection
    let model: EyeModel | null = null
    let gaze: Gaze | null = null
    if (settings.format === "spatial") {
      detection = this.pupils.accept(
        this.pupils.detect(
          gray,
          roi.width,
          roi.height,
          settings.threshold,
          timestamp,
          { thresholdMode: settings.thresholdMode, includePreviewMasks }
        ),
        timestamp,
        roi.width,
        roi.height
      )
      const e = detection.ellipse
      model = this.model.getLatest()
      if (e && !settings.locked && detection.shapeObserved !== false) {
        model = this.model.observe(
          { ...e, center: [e.center[0] + roi.x, e.center[1] + roi.y] },
          width,
          height,
          roi.width,
          roi.height
        )
      }
    } else {
      model = createManualEyeModel(settings.corners, width, height)
      const center = model?.center ?? [
        roi.x + roi.width / 2,
        roi.y + roi.height / 2,
      ]
      detection = this.pupils.accept(
        this.pupils.detect(
          gray,
          roi.width,
          roi.height,
          settings.threshold,
          timestamp,
          {
            thresholdMode: "manual",
            expectedCenter: [center[0] - roi.x, center[1] - roi.y],
            includePreviewMasks,
          }
        ),
        timestamp,
        roi.width,
        roi.height
      )
    }
    const slippage = this.slippage.observe(detection, {
      width,
      height,
      roi,
      model,
      locked: settings.locked,
      timestamp,
    })
    const ellipse = detection.ellipse
    if (ellipse && detection.tracking === "tracking" && model?.ready) {
      // Return the pupil to the image coordinates used by the locked model.
      // Detection and preview remain the fresh, unmodified image evidence.
      const pupil: Point = [
        ellipse.center[0] + roi.x - slippage.offset[0],
        ellipse.center[1] + roi.y - slippage.offset[1],
      ]
      if (settings.format === "spatial") {
        const k = cameraIntrinsics(width, height, settings.fov)
        const sphere =
          k &&
          sphereFromProjection(model.center, model.radius, settings.radiusMm, k)
        if (sphere && k) {
          gaze = gazeFromPupil(pupil, sphere, k)
        }
      } else {
        const v = gazeVector3D(pupil, model.center, model.radius)
        gaze = {
          origin: [0, 0, 0],
          direction: [v[0], v[1], -v[2]],
          pupil: [...v],
        }
      }
    }
    return {
      id,
      timestamp,
      width,
      height,
      roi,
      detection,
      model,
      gaze,
      slippage,
      processingMs: performance.now() - start,
    }
  }
}
