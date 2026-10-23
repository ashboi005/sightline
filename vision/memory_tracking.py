"""Bounded per-camera mask memory, with verified recovery after absence."""

import math
import time
from collections import deque

from appearance import confirm_region
from context_acquisition import AcquiredRegion
from flow import follow_flow
from matching import Reference, box_overlap, crop, valid_box


class MemoryTracker:
    def __init__(
        self,
        image,
        box,
        *,
        backend,
        reference=None,
        appearance=None,
        clock=time.monotonic,
        acquisition=None,
    ):
        context_verified = (
            isinstance(acquisition, AcquiredRegion)
            and acquisition.reference is reference
            and acquisition.image is image
            and box_overlap(acquisition.box, valid_box(box)) >= 0.9
        )
        if (
            reference is not None
            and not context_verified
            and confirm_region(reference, image, box)["status"] != "matched"
        ):
            raise ValueError("Could not verify the original selected object here.")
        self.appearance = appearance
        self.recovering = False
        self.clear_confirmation()
        self.backend = backend
        self.clock = clock
        self.shape = image.shape
        self.previous = image.copy()
        self.reference = reference if reference is not None else Reference(image, valid_box(box))
        self.outputs = {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}}
        self.index = 0
        self.last_index = 0
        self.active = True
        self.misses = 0
        self.reset = False
        initial = (
            acquisition.prediction
            if context_verified and acquisition.prediction is not None
            else self.backend.predict(image, valid_box(box), self.index, self.outputs)
        )
        if not self.acceptable(initial) or box_overlap(initial.box, box) < 0.5:
            raise ValueError(
                "Could not isolate this object. Draw a tighter box in Scene and retry."
            )
        self.box = initial.box
        self.outputs["cond_frame_outputs"][0] = initial.memory
        self.index = 1
        self.last_seen = self.clock()
        self.trusted_crop = crop(image, initial.box) if initial.quality >= 0.8 else None
        self.trusted_box = list(initial.box)
        self.trusted_index = 0
        self.trusted_time = self.last_seen
        self.trusted_views = deque(maxlen=3)
        if self.trusted_crop is not None:
            self.trusted_views.append((self.trusted_crop, self.trusted_box, 0, self.last_seen))

    @staticmethod
    def valid_prediction(prediction):
        if not all(math.isfinite(x) for x in (prediction.presence, prediction.quality)):
            return False
        if not 0 <= prediction.presence <= 1 or not 0 <= prediction.quality <= 1:
            return False
        try:
            valid_box(prediction.box)
        except (ValueError, TypeError):
            return False
        return True

    @classmethod
    def acceptable(cls, prediction):
        return (
            cls.valid_prediction(prediction)
            and prediction.presence > 0.8
            and prediction.quality >= 0.5
        )

    def recent_recovery(self, index, now):
        return (
            self.appearance is not None
            and self.trusted_crop is not None
            and index - self.trusted_index <= 12
            and now - self.trusted_time <= 2
        )

    def clear_confirmation(self):
        self.pending_box = None
        self.pending_memory = None
        self.pending_fast = False
        self.pending_index = 0
        self.pending_time = 0

    def memory_agrees(self, candidate, anchor):
        if anchor is None:
            return False
        score = self.backend.similarity(candidate, anchor)
        return math.isfinite(score) and 0.8 < score <= 1

    def motion_agrees(self, first, second):
        height, width = self.shape[:2]
        first_width, first_height = first[2] - first[0], first[3] - first[1]
        second_area = (second[2] - second[0]) * (second[3] - second[1])
        if not 1 / 3 <= second_area / (first_width * first_height) <= 3:
            return False
        dx = (second[0] + second[2] - first[0] - first[2]) * width / 2
        dy = (second[1] + second[3] - first[1] - first[3]) * height / 2
        extent = math.hypot(first_width * width, first_height * height)
        next_extent = math.hypot((second[2] - second[0]) * width, (second[3] - second[1]) * height)
        # A diagonal bound tolerates rotation without accepting a thin stripe
        # or an enlarged containing mask just because its area is unchanged.
        return 0.5 <= next_extent / extent <= 2 and math.hypot(dx, dy) <= 1.5 * extent

    def verify_recent(self, image, prediction):
        if not self.recovering:
            self.clear_confirmation()
            return False
        motion = follow_flow(self.previous, image, self.box)
        verified = motion is not None and box_overlap(motion["box"], prediction.box) >= 0.5
        fast_verified = False
        if not verified and (prediction.presence <= 0.95 or prediction.quality < 0.65):
            # Hide uncertainty without erasing a recent verified observation.
            # True absence and time/frame expiry are handled in update().
            return False
        if not verified:
            candidate = crop(image, prediction.box)
            for view, box, index, timestamp in reversed(self.trusted_views):
                if self.index - 1 - index > 12 or self.clock() - timestamp > 2:
                    continue
                x1, y1, x2, y2 = prediction.box
                candidate_area = (x2 - x1) * (y2 - y1)
                anchor_area = (box[2] - box[0]) * (box[3] - box[1])
                intersection = max(0, min(x2, box[2]) - max(x1, box[0])) * max(
                    0, min(y2, box[3]) - max(y1, box[1])
                )
                # Bound extent so a containing whole-person/frame mask cannot
                # stand in for the selected part, including after fast motion.
                if not 1 / 3 <= candidate_area / anchor_area <= 3:
                    continue
                spatial_support = (
                    box_overlap(box, prediction.box) >= 0.4
                    or intersection / min(candidate_area, anchor_area) >= 0.7
                )
                anchor = (
                    self.outputs["cond_frame_outputs"].get(index)
                    if index == 0
                    else self.outputs["non_cond_frame_outputs"].get(index)
                )
                memory_verified = self.memory_agrees(prediction.memory, anchor)
                if not spatial_support:
                    # A fast-moving object need not occupy its old pixels.
                    # Require stronger mask evidence and bounded displacement;
                    # descriptor similarity alone cannot authorize a jump.
                    if (
                        prediction.quality >= 0.8
                        and self.motion_agrees(box, prediction.box)
                        and memory_verified
                    ):
                        verified = fast_verified = True
                        break
                    continue
                if memory_verified:
                    verified = True
                    break
                if prediction.quality >= 0.8:
                    score = self.appearance.score(view, candidate)
                    # Descriptor similarity is distinct from object presence and
                    # identity probability. Only brief two-frame recovery uses it.
                    if math.isfinite(score) and 0.7 < score <= 1:
                        verified = True
                        break
        if not verified:
            self.clear_confirmation()
            return False
        previous = self.pending_box
        consistent = False
        if previous is not None:
            if fast_verified or self.pending_fast:
                consistent = self.motion_agrees(previous, prediction.box) and self.memory_agrees(
                    prediction.memory, self.pending_memory
                )
            else:
                consistent = box_overlap(previous, prediction.box) >= 0.5
        # Keep one unconfirmed observation, outside accepted SAM memory. It
        # cannot alter a trusted recovery view or the immutable reference.
        self.pending_box = list(prediction.box)
        self.pending_memory = prediction.memory
        self.pending_fast = fast_verified
        self.pending_index = self.index - 1
        self.pending_time = self.clock()
        return consistent

    def update(self, image):
        if self.reset:
            return {"status": "searching"}
        now = self.clock()
        if image.shape != self.shape or now - self.last_seen > 5:
            self.active = False
            self.recovering = False
            self.trusted_crop = None
            self.trusted_views.clear()
            self.clear_confirmation()
            self.reset = True
            self.outputs = {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}}
            return {"status": "searching"}
        self.last_seen = now
        index = self.index
        self.index += 1
        self.recovering = self.recent_recovery(index, now)
        if index - self.pending_index > 3 or now - self.pending_time > 1:
            self.clear_confirmation()
        recent = self.outputs["non_cond_frame_outputs"]
        # Keep absolute indices. The model can attend to conditioning memory even
        # when uncertain/absent frames were deliberately not committed.
        for old in list(recent):
            if old <= index - 16:
                del recent[old]
        if image.std() < 2:
            self.active = False
            self.clear_confirmation()
            return {"status": "searching"}
        prediction = self.backend.predict(image, None, index, self.outputs)
        if not self.acceptable(prediction):
            if not self.valid_prediction(prediction) or prediction.presence <= 0.8:
                self.clear_confirmation()
            self.misses += 1
            if (
                prediction.box is None
                or not math.isfinite(prediction.presence)
                or prediction.presence <= 0.8
                or self.misses >= 8
            ):
                self.active = False
            return {"status": "searching"}
        old_area = (self.box[2] - self.box[0]) * (self.box[3] - self.box[1])
        new_area = (prediction.box[2] - prediction.box[0]) * (prediction.box[3] - prediction.box[1])
        overlap = box_overlap(self.box, prediction.box)
        extent_changed = not 1 / 3 <= new_area / old_area <= 3
        supported_motion = False
        if (
            self.active
            and 0 < overlap < 0.1
            and not extent_changed
            and prediction.presence > 0.95
            and prediction.quality >= 0.8
        ):
            previous_memory = (
                self.outputs["cond_frame_outputs"].get(0)
                if self.last_index == 0
                else recent.get(self.last_index)
            )
            supported_motion = self.memory_agrees(prediction.memory, previous_memory)
        # Weak overlap during quick movement is allowed only with strong recent
        # mask evidence. Zero overlap and abrupt expansion still need recovery.
        discontinuous = extent_changed or (overlap < 0.1 and not supported_motion)
        if self.active and discontinuous:
            # A new distant mask must be corroborated before it can rewrite
            # camera memory or the short recovery anchor.
            motion = follow_flow(self.previous, image, self.box)
            if motion is None or box_overlap(motion["box"], prediction.box) < 0.4:
                self.active = False
                self.clear_confirmation()
        if not self.active:
            # A confident new mask after loss is not proof of the same instance.
            # Verify against the immutable Scene selection before restoring lock.
            confirmed = confirm_region(self.reference, image, prediction.box)
            if confirmed["status"] != "matched" and not self.verify_recent(image, prediction):
                return {"status": "searching"}
        self.active = True
        self.recovering = False
        self.clear_confirmation()
        self.misses = 0
        self.box = list(prediction.box)
        self.previous = image.copy()
        recent[index] = prediction.memory
        self.last_index = index
        if prediction.quality >= 0.8 and prediction.presence > 0.95:
            self.trusted_crop = crop(image, prediction.box)
            self.trusted_box = self.box
            self.trusted_index = index
            self.trusted_time = self.clock()
            self.trusted_views.append(
                (self.trusted_crop, self.trusted_box, index, self.trusted_time)
            )
        return {
            "status": "matched",
            "box": self.box,
            "score": prediction.presence,
            "maskQuality": prediction.quality,
            "method": "temporal",
        }
