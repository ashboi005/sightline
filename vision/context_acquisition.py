"""Small-region acquisition from immutable Scene memory and unique context.

Context proposes a location; it never establishes object presence on its own.
Two independently inferred masks must corroborate the selected region there.
"""

import math
import time
from dataclasses import dataclass

from appearance import choose_appearance
from matching import Reference, box_overlap, project_box, valid_box


@dataclass(frozen=True)
class AcquiredRegion:
    reference: Reference
    image: object
    box: list
    prediction: object = None


def consistent_observation(previous, prediction, now, backend):
    if previous is None or not 0 <= now - previous[2] <= 1:
        return False
    score = backend.similarity(prediction.memory, previous[1])
    return (
        box_overlap(previous[0], prediction.box) >= 0.5
        and math.isfinite(score)
        and 0.8 < score <= 1
    )


class ContextAcquisition:
    def __init__(self, image, box, reference, anchor, backend, clock=time.monotonic):
        height, width = image.shape[:2]
        x1, y1, x2, y2 = box
        left, top, right, bottom = (
            round(x1 * width),
            round(y1 * height),
            round(x2 * width),
            round(y2 * height),
        )
        a, b, c, d = (
            max(0, left - 24),
            max(0, top - 24),
            min(width, right + 24),
            min(height, bottom + 24),
        )
        self.context = Reference(image, (a / width, b / height, c / width, d / height))
        self.relative = [
            (left - a) / (c - a),
            (top - b) / (d - b),
            (right - a) / (c - a),
            (bottom - b) / (d - b),
        ]
        self.reference = reference
        self.anchor = anchor
        self.backend = backend
        self.clock = clock
        self.reset()

    @classmethod
    def create(cls, image, box, reference, anchor, backend):
        height, width = reference.image.shape[:2]
        if not 12 <= min(height, width) < 64 or max(height, width) >= 160:
            return None
        return cls(image, box, reference, anchor, backend)

    def reset(self):
        self.pending = None
        self.shape = None

    def update(self, image):
        if self.shape != image.shape:
            self.reset()
            self.shape = image.shape
        context = choose_appearance(self.context, image, unique_region=self.relative)
        if context["status"] != "matched":
            self.pending = None
            return context
        proposed = project_box(context["box"], self.relative)
        # Original Scene conditioning is read-only. Each attempt is independent;
        # failed candidates never enter either camera's accepted memory.
        prediction = self.backend.predict(
            image, None, 1, {"cond_frame_outputs": {0: self.anchor}, "non_cond_frame_outputs": {}}
        )
        try:
            valid_box(prediction.box)
        except (TypeError, ValueError):
            self.pending = None
            return {"status": "searching"}
        score = self.backend.similarity(prediction.memory, self.anchor)
        if (
            not 0.95 < prediction.presence <= 1
            or not 0.8 <= prediction.quality <= 1
            or not math.isfinite(score)
            or not 0.7 < score <= 1
            or box_overlap(proposed, prediction.box) < 0.5
        ):
            self.pending = None
            return {"status": "searching"}
        now = self.clock()
        previous = self.pending
        self.pending = (list(prediction.box), prediction.memory, now)
        if not consistent_observation(previous, prediction, now, self.backend):
            return {"status": "searching"}
        self.pending = None
        return {
            "status": "matched",
            "box": list(prediction.box),
            "score": prediction.presence,
            "maskQuality": prediction.quality,
            "method": "temporal",
            "acquisition": AcquiredRegion(self.reference, image, list(prediction.box)),
        }
