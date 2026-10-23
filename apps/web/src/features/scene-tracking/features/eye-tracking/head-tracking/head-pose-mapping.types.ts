export type PoseGazeFeatures = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export type HeadPoseMapping = {
  center: PoseGazeFeatures
  scale: PoseGazeFeatures
  /** Intercept, two eye-feature gains, then six measured head-motion gains. */
  coefficients: [number[], number[]]
}
