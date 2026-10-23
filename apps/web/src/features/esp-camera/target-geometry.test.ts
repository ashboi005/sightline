import { expect, test } from "bun:test";
import { cameraFrameGeometry } from "../scene-tracking/features/eye-tracking/camera-transform";
import { sensorTargetX } from "./target-geometry";

test("pan coordinates undo every display rotation and mirror, including portrait sensors", () => {
  for (const rotation of [0, 45, 90, 180, 270])
    for (const mirrorX of [false, true])
      for (const mirrorY of [false, true]) {
        const transform = { rotation, mirrorX, mirrorY };
        const geometry = cameraFrameGeometry(600, 800, transform);
        const [a, b, c, d, e, f] = geometry.matrix;
        const x = (a * 480 + c * 240 + e) / geometry.width;
        const y = (b * 480 + d * 240 + f) / geometry.height;
        expect(
          sensorTargetX(
            [x, y],
            { ...geometry, inputWidth: 600, inputHeight: 800 },
            transform,
          ),
        ).toBeCloseTo(0.8, 8);
      }
});
test("unknown geometry and points outside the sensor cannot command servos", () => {
  const transform = { rotation: 0, mirrorX: false, mirrorY: false };
  expect(
    sensorTargetX([0.5, 0.5], { width: 640, height: 480 }, transform),
  ).toBeNull();
  expect(
    sensorTargetX(
      [2, 0.5],
      { width: 640, height: 480, inputWidth: 640, inputHeight: 480 },
      transform,
    ),
  ).toBeNull();
});
