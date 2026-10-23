import type { CalibrationSample } from "../calibration.types"
import { collectHeadMeasurements } from "./head-calibration-data"
import { projectHeadGaze } from "./head-gaze-model"
import type {
  HeadGazeModel,
  HeadGazeModelFitResult,
} from "./head-gaze-model.types"
import type {
  HeadModelMethod,
  HeadModelValidationResult,
} from "./head-model-validation.types"
import { fitHeadPoseMapping } from "./head-pose-mapping"
import type { HeadPose } from "./head-pose.types"
import { fitHeadRayGeometryWithDiagnostics } from "./head-ray-fit"
const MAXIMUM_TRAINING_ERROR_PER_AXIS = 0.03
const MAXIMUM_VALIDATION_ERROR = 0.03
const MAXIMUM_FIXATION_ERROR = 0.06
function fitModel(
  samples: CalibrationSample[],
  reference: HeadPose,
  aspect: number,
  method: HeadModelMethod
): HeadGazeModelFitResult {
  const readings = collectHeadMeasurements(samples)
  if (!readings) {
    return {
      model: null,
      issue: {
        code: "head-samples",
        message: "Head readings were missing. Reconnect the front camera.",
      },
    }
  }
  if (method === "calibrated-pose-regression") {
    const mapping = fitHeadPoseMapping(readings, reference)
    if (mapping) {
      return { model: { method, mapping }, issue: null }
    }
    return {
      model: null,
      issue: {
        code: "head-geometry",
        message:
          "Eye and head movement were not independent enough to learn compensation. Retry the head pass.",
      },
    }
  }
  const fitted = fitHeadRayGeometryWithDiagnostics(
    samples,
    readings,
    reference,
    aspect
  )
  if (!fitted.geometry) {
    return { model: null, issue: fitted.issue }
  }
  return { model: { method, geometry: fitted.geometry }, issue: null }
}
function fixationSquaredError(
  model: HeadGazeModel,
  sample: CalibrationSample,
  reference: HeadPose
): number {
  // Fitting can subsample a hold; accuracy scoring must include every retained reading.
  const readings = collectHeadMeasurements([sample], Infinity)
  if (!readings) {
    return Infinity
  }
  let error = 0
  for (const reading of readings) {
    const point = projectHeadGaze(
      model,
      reading.feature,
      reading.pose,
      reference
    )
    if (!point) {
      return Infinity
    }
    error +=
      reading.weight *
      ((point[0] - reading.target[0]) ** 2 +
        (point[1] - reading.target[1]) ** 2)
  }
  // Average squared errors, not predictions: opposite errors must not cancel each other.
  return error
}
/** Both model families face the same training and whole-fixation accuracy gates. */
export function fitValidatedHeadModel(
  samples: CalibrationSample[],
  reference: HeadPose,
  aspect: number,
  method: HeadModelMethod,
  validate = true
): HeadModelValidationResult {
  const fitted = fitModel(samples, reference, aspect, method)
  const failed: HeadModelValidationResult = {
    model: null,
    issue: fitted.issue,
    validationError: Infinity,
    maximumValidationError: Infinity,
  }
  if (!fitted.model) {
    return failed
  }
  const model = fitted.model
  const trainingError = Math.sqrt(
    samples.reduce(
      (sum, sample) => sum + fixationSquaredError(model, sample, reference),
      0
    ) /
      (2 * samples.length)
  )
  if (
    !Number.isFinite(trainingError) ||
    trainingError > MAXIMUM_TRAINING_ERROR_PER_AXIS
  ) {
    return {
      ...failed,
      issue: {
        code: "head-geometry",
        measuredError: trainingError,
        message:
          "Head and eye readings disagreed. Retry the head movements while looking at the center dot.",
      },
    }
  }
  if (!validate) {
    return {
      model,
      issue: null,
      validationError: trainingError * Math.sqrt(2),
      maximumValidationError: 0,
    }
  }
  let squaredError = 0
  let maximumValidationError = 0
  for (let index = 0; index < samples.length; index++) {
    const training = samples.filter((_, sampleIndex) => sampleIndex !== index)
    const heldOut = fitModel(training, reference, aspect, method)
    if (!heldOut.model) {
      return { ...failed, issue: heldOut.issue }
    }
    const error = fixationSquaredError(heldOut.model, samples[index], reference)
    squaredError += error
    maximumValidationError = Math.max(maximumValidationError, Math.sqrt(error))
  }
  const validationError = Math.sqrt(squaredError / samples.length)
  if (
    !Number.isFinite(validationError) ||
    validationError > MAXIMUM_VALIDATION_ERROR ||
    maximumValidationError > MAXIMUM_FIXATION_ERROR
  ) {
    return {
      ...failed,
      validationError,
      maximumValidationError,
      issue: {
        code: "head-validation",
        measuredError: maximumValidationError,
        message:
          "Head compensation did not stay accurate across every fixation. Retry just the head pass.",
      },
    }
  }
  return { model, issue: null, validationError, maximumValidationError }
}
