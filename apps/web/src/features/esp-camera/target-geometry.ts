import {
  cameraFrameGeometry,
  type CameraTransform,
} from "../scene-tracking/features/eye-tracking/camera-transform";

/** Invert the exact drawing transform; display rotation must not reverse physical pan. */
export function sensorTargetX(
  point: readonly [number, number],
  frame: {
    width: number;
    height: number;
    inputWidth?: number;
    inputHeight?: number;
  },
  transform: CameraTransform,
): number | null {
  const { inputWidth: width, inputHeight: height } = frame;
  if (!width || !height || !point.every(Number.isFinite)) return null;
  const [a, b, c, d, e, f] = cameraFrameGeometry(
    width,
    height,
    transform,
    frame,
  ).matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9)
    return null;
  const px = point[0] * frame.width - e;
  const py = point[1] * frame.height - f;
  const x = (d * px - c * py) / determinant / width;
  const y = (a * py - b * px) / determinant / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? x : null;
}
