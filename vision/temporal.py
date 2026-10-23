"""Class-independent NanoTrack following; scores are evidence, not identity probabilities."""

import math
import time

from appearance import confirm_region
from flow import follow_flow
from matching import Reference, box_overlap, valid_box
from nanotrack import NanoTracker


class TemporalTracker:
    def __init__(
        self,
        image,
        box,
        *,
        reference=None,
        clock=time.monotonic,
        factory=NanoTracker,
        flow=follow_flow,
    ):
        self.clock = clock
        self.last_seen = clock()
        self.shape = image.shape
        self.misses = 0
        self.active = True
        height, width = image.shape[:2]
        x1, y1, x2, y2 = valid_box(box)
        pixels = (
            round(x1 * width),
            round(y1 * height),
            max(1, round((x2 - x1) * width)),
            max(1, round((y2 - y1) * height)),
        )
        self.flow = flow
        self.reference = reference if reference is not None else Reference(image, valid_box(box))
        self.previous = image.copy()
        self.box = [x1, y1, x2, y2]
        self.tracker = factory()
        self.tracker.init(image, pixels)

    def miss(self):
        self.misses += 1
        if self.misses >= 3:
            self.active = False
        return {"status": "searching"}

    def update(self, image):
        now = self.clock()
        if not self.active:
            return {"status": "searching"}
        if image.shape != self.shape or now - self.last_seen > 1 or image.std() < 2:
            self.active = False
            return {"status": "searching"}
        self.last_seen = now
        ok, pixels = self.tracker.update(image)
        score = float(self.tracker.getTrackingScore())
        height, width = image.shape[:2]
        x, y, w, h = pixels
        box = [
            max(0, x / width),
            max(0, y / height),
            min(1, (x + w) / width),
            min(1, (y + h) / height),
        ]
        if (
            not ok
            or not math.isfinite(score)
            or not 0.8 < score <= 1
            or w < 4
            or h < 4
            or box[0] >= box[2]
            or box[1] >= box[3]
        ):
            return self.miss()
        motion = self.flow(self.previous, image, self.box)
        if motion is not None and box_overlap(box, motion["box"]) < 0.4:
            return self.miss()
        if motion is not None:
            box = motion["box"]
        confirmed = confirm_region(self.reference, image, box)
        if confirmed["status"] != "matched":
            return self.miss()
        # Fixed appearance prevents gradual changes in the previous frame from
        # promoting a different object into the selected object's reference.
        box = confirmed["box"]
        pixels = (
            round(box[0] * width),
            round(box[1] * height),
            round((box[2] - box[0]) * width),
            round((box[3] - box[1]) * height),
        )
        self.misses = 0
        self.box = box
        self.previous = image.copy()
        self.tracker.init(image, pixels)
        return {**confirmed, "method": "temporal"}
