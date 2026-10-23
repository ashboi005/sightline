import type { CalibrationSample } from "../calibration.types"
import type { HeadRayMeasurement } from "./head-ray-model.types"
/** Every fixation has equal weight, regardless of its camera frame rate. */
export function collectHeadMeasurements(
  samples: CalibrationSample[],
  maximumReadingsPerFixation = 5
): HeadRayMeasurement[] | null {
  const readings: HeadRayMeasurement[] = []
  for (const sample of samples) {
    if (!sample.headPose) {
      return null
    }
    const measurements = sample.headMeasurements ?? [
      { feature: sample.feature, pose: sample.headPose },
    ]
    if (measurements.length === 0) {
      return null
    }
    const count = Math.min(maximumReadingsPerFixation, measurements.length)
    for (let index = 0; index < count; index++) {
      const reading =
        measurements[Math.floor((index * measurements.length) / count)]
      if (
        ![
          ...reading.feature,
          ...reading.pose.position,
          ...reading.pose.rotation,
          ...sample.target,
        ].every(Number.isFinite)
      ) {
        return null
      }
      readings.push({ ...reading, target: sample.target, weight: 1 / count })
    }
  }
  return readings
}
