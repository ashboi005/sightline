"""NanoTrack v3 ONNX inference with its native 15x15 response map.

Adapted decoding from HonglinChu's Apache-2.0 NanoTrack implementation.
Modified for OpenCV DNN/NumPy, validated outputs, and bounded local inference.
See NOTICE.md and licenses/NanoTrack-APACHE-2.0.txt.
"""

import cv2
import numpy as np

from prepare import MODELS


class NanoTracker:
    def __init__(self):
        self.backbone = cv2.dnn.readNet(str(MODELS / "v3-nanotrack_backbone.onnx"))
        self.head = cv2.dnn.readNet(str(MODELS / "v3-nanotrack_head.onnx"))
        grid = (np.arange(15) - 7) * 16
        x, y = np.meshgrid(grid, grid)
        self.points = np.stack([x.ravel(), y.ravel()])
        self.window = np.outer(np.hanning(15), np.hanning(15)).ravel()
        self.score = 0

    def crop(self, image, side, size):
        side = max(2, round(side))
        first = np.floor(self.center - (side + 1) / 2 + 0.5).astype(int)
        last = first + side
        h, w = image.shape[:2]
        padding = [max(0, -first[0]), max(0, -first[1]), max(0, last[0] - w), max(0, last[1] - h)]
        left, top, right, bottom = padding
        padded = cv2.copyMakeBorder(
            image, top, bottom, left, right, cv2.BORDER_CONSTANT, value=tuple(self.average)
        )
        roi = padded[first[1] + top : last[1] + top, first[0] + left : last[0] + left]
        return cv2.dnn.blobFromImage(cv2.resize(roi, (size, size)), swapRB=False)

    def init(self, image, box):
        x, y, w, h = box
        self.center = np.array([x + (w - 1) / 2, y + (h - 1) / 2], float)
        self.size = np.array([w, h], float)
        self.average = image.mean(axis=(0, 1))
        side = np.sqrt(np.prod(self.size + 0.5 * self.size.sum()))
        self.backbone.setInput(self.crop(image, side, 127))
        self.head.setInput(self.backbone.forward(), "input1")

    def update(self, image):
        side = np.sqrt(np.prod(self.size + 0.5 * self.size.sum()))
        scale = 127 / side
        self.backbone.setInput(self.crop(image, side * 255 / 127, 255))
        self.head.setInput(self.backbone.forward(), "input2")
        cls, loc = self.head.forward(["output1", "output2"])
        if (
            cls.shape != (1, 2, 15, 15)
            or loc.shape != (1, 4, 15, 15)
            or not np.isfinite(cls).all()
            or not np.isfinite(loc).all()
        ):
            raise RuntimeError("NanoTrack returned invalid model output.")
        cls = cls.reshape(2, -1)
        cls = np.exp(cls - cls.max(axis=0))
        score = cls[1] / cls.sum(axis=0)
        delta = loc.reshape(4, -1)
        low = self.points - delta[:2]
        high = self.points + delta[2:]
        size = np.maximum(high - low, 1e-6)
        center = (high + low) / 2

        def sz(value):
            pad = value.sum(axis=0) * 0.5
            return np.sqrt((value[0] + pad) * (value[1] + pad))

        def change(value):
            return np.maximum(value, 1 / np.maximum(value, 1e-8))

        penalty = np.exp(
            -(
                change(sz(size) / sz(self.size * scale))
                * change((self.size[0] / self.size[1]) / (size[0] / size[1]))
                - 1
            )
            * 0.138
        )
        ranking = penalty * score * (1 - 0.455) + self.window * 0.455
        best = int(np.argmax(ranking))
        learning = penalty[best] * score[best] * 0.348
        self.center += center[:, best] / scale
        self.size = self.size * (1 - learning) + size[:, best] / scale * learning
        h, w = image.shape[:2]
        self.center = np.clip(self.center, [0, 0], [w, h])
        self.size = np.clip(self.size, [10, 10], [w, h])
        self.score = float(score[best])
        origin = self.center - self.size / 2
        return True, tuple(round(v) for v in np.r_[origin, self.size])

    def getTrackingScore(self):
        return self.score
