"""Bounded cross-camera acquisition with immutable original Scene evidence."""

import math
import time

from camera_quality import quality_pair
from context_acquisition import AcquiredRegion, consistent_observation
from matching import box_overlap, crop, valid_box


class CrossCameraAcquisition:
    def __init__(self, reference, anchor, backend, appearance, clock=time.monotonic):
        self.reference = reference
        self.anchor = anchor
        self.backend = backend
        self.appearance = appearance
        self.clock = clock
        self.reset()

    def reset(self):
        self.pending = None
        self.shape = None

    def update(self, image, candidates, deadline):
        if image.shape != self.shape:
            self.reset()
            self.shape = image.shape
        previous = self.pending
        # Consume old proof before inference: an invalid result or backend error
        # cannot leave it available to a later frame.
        self.pending = None
        if not candidates or len(candidates) > 20 or self.appearance is None:
            return {"status": "ambiguous" if len(candidates) > 20 else "searching"}
        plausible = []
        for candidate in candidates:
            if time.monotonic() >= deadline:
                return {"status": "searching"}
            if quality_pair(self.reference.image, crop(image, candidate.box)) is not None:
                plausible.append(candidate)
        # Do cheap verification across the bounded detector output first. Never
        # accept a winner while another plausible candidate remains unchecked.
        if len(plausible) > 5:
            return {"status": "ambiguous"}
        verified = []
        for candidate in plausible:
            if time.monotonic() >= deadline:
                return {"status": "searching"}
            prediction = self.backend.predict(
                image, candidate.box, 0, {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}}
            )
            if prediction.box is None:
                continue
            try:
                valid_box(prediction.box)
            except (TypeError, ValueError):
                return {"status": "searching"}
            if (
                not 0.95 < prediction.presence <= 1
                or not 0.8 <= prediction.quality <= 1
                or box_overlap(prediction.box, candidate.box) < 0.5
            ):
                continue
            # Same Source corroboration floor as small-object context search;
            # raw colour, coarse detail and DINO remain independent required gates.
            # The two Target observations still require token cosine >0.8.
            similarity = self.backend.similarity(prediction.memory, self.anchor)
            if not math.isfinite(similarity) or not 0.7 < similarity <= 1:
                continue
            views = quality_pair(self.reference.image, crop(image, prediction.box))
            if views is None:
                continue
            descriptor = self.appearance.score(views[0], views[1])
            if math.isfinite(descriptor) and 0.7 < descriptor <= 1:
                if not any(box_overlap(prediction.box, other.box) > 0.5 for other in verified):
                    verified.append(prediction)
        if len(verified) != 1:
            self.pending = None
            return {"status": "ambiguous" if verified else "searching"}
        prediction = verified[0]
        now = self.clock()
        confirmed = consistent_observation(previous, prediction, now, self.backend)
        self.pending = (list(prediction.box), prediction.memory, now)
        if not confirmed:
            return {"status": "searching"}
        self.pending = None
        return {
            "status": "matched",
            "box": list(prediction.box),
            "score": prediction.presence,
            "maskQuality": prediction.quality,
            "method": "temporal",
            "acquisition": AcquiredRegion(self.reference, image, list(prediction.box), prediction),
        }
