from functools import partial

import cv2
import numpy as np

from temporal import TemporalTracker as Tracker

TemporalTracker = partial(Tracker, flow=lambda *_args: None)


def textured():
    image = np.zeros((240, 320, 3), np.uint8)
    cv2.rectangle(image, (60, 50), (160, 180), (70, 120, 220), -1)
    cv2.putText(image, "OBJECT", (65, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return image


class InferenceBoundary:
    def __init__(self, score=0.91, box=(90, 70, 100, 130)):
        self.score, self.box = score, box

    def init(self, image, box):
        pass

    def update(self, image):
        return True, self.box

    def getTrackingScore(self):
        return self.score


def test_continuous_boxes_move_and_remain_normalized():
    tracker = TemporalTracker(
        textured(),
        (0.1875, 0.208333, 0.5, 0.75),
        factory=iter([InferenceBoundary(), InferenceBoundary(box=(60, 50, 100, 130))]).__next__,
    )
    moved = cv2.warpAffine(textured(), np.float32([[1, 0, 30], [0, 1, 20]]), (320, 240))
    result = tracker.update(moved)
    assert result["status"] == "matched"
    assert result["method"] == "temporal"
    assert result["box"] == [0.28125, 70 / 240, 0.59375, 200 / 240]
    assert result["score"] > 0.92


def test_low_scores_and_blank_frames_never_produce_a_box():
    tracker = TemporalTracker(
        textured(), (0.1875, 0.208333, 0.5, 0.75), factory=lambda: InferenceBoundary(0.8)
    )
    assert tracker.update(textured()) == {"status": "searching"}
    tracker = TemporalTracker(textured(), (0.1875, 0.208333, 0.5, 0.75), factory=InferenceBoundary)
    assert tracker.update(np.zeros((240, 320, 3), np.uint8)) == {"status": "searching"}


def test_long_gaps_and_dimension_changes_invalidate_the_temporal_tracker():
    clock = [0.0]
    tracker = TemporalTracker(
        textured(), (0.1875, 0.208333, 0.5, 0.75), clock=lambda: clock[0], factory=InferenceBoundary
    )
    clock[0] = 1.1
    assert tracker.update(textured()) == {"status": "searching"}
    assert not tracker.active
    tracker = TemporalTracker(textured(), (0.1875, 0.208333, 0.5, 0.75), factory=InferenceBoundary)
    assert tracker.update(np.zeros((480, 640, 3), np.uint8)) == {"status": "searching"}
    assert not tracker.active


def test_a_high_score_cannot_hide_a_drift_to_another_region():
    # A confident proposal outside the selected appearance must stay unconfirmed.
    tracker = TemporalTracker(
        textured(),
        (0.1875, 0.208333, 0.5, 0.75),
        factory=lambda: InferenceBoundary(0.99, (200, 20, 100, 130)),
    )
    assert tracker.update(textured()) == {"status": "searching"}


def test_confident_motion_to_a_plain_region_does_not_continue_the_original_track():
    original = textured()
    # Other pixels remain textured, but the object is absent at the proposed box.
    image = original.copy()
    image[50:180, 60:160] = [70, 120, 220]
    tracker = TemporalTracker(
        original,
        (0.1875, 50 / 240, 0.5, 0.75),
        factory=lambda: InferenceBoundary(0.99, (60, 50, 100, 130)),
    )
    assert tracker.update(image) == {"status": "searching"}


def test_strong_flow_contradiction_rejects_a_similar_object_switch():
    from test_matching import textured_image

    image = np.concatenate([textured_image(), textured_image()], axis=1)
    tracker = Tracker(
        image, (0, 0, 0.5, 1), factory=lambda: InferenceBoundary(0.99, (320, 0, 320, 240))
    )
    assert tracker.update(image) == {"status": "searching"}


def test_gradual_appearance_drift_cannot_replace_the_selected_object():
    from test_matching import textured_image

    selected = textured_image(42)
    unrelated = textured_image(88)
    tracker = TemporalTracker(
        selected, (0, 0, 1, 1), factory=lambda: InferenceBoundary(0.99, (0, 0, 320, 240))
    )
    # Each adjacent image stays similar, while the final region is entirely
    # different. Verification against only the previous frame permits this drift.
    for index in range(1, 11):
        frame = cv2.addWeighted(selected, 1 - index / 10, unrelated, index / 10, 0)
        result = tracker.update(frame)
    assert result == {"status": "searching"}
    assert not tracker.active
