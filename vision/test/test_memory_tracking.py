"""Policy regressions at the expensive segmentation inference boundary.

Real motion/pose accuracy is measured separately with the supplied local clip.
"""

from collections import deque
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from test_matching import textured_image

from memory_tracking import MemoryTracker


class SegmentationBoundary:
    def __init__(self, predictions):
        self.predictions = deque(predictions)

    def similarity(self, candidate, anchor):
        return 0

    def predict(self, image, box, index, outputs):
        candidate, presence, quality = self.predictions.popleft()
        return SimpleNamespace(
            box=candidate, presence=presence, quality=quality, memory={"frame": index}
        )


def test_angle_change_does_not_require_original_pixel_equality():
    image = textured_image(42)
    box = [0, 0, 1, 1]
    backend = SegmentationBoundary([(box, 0.99, 0.94)] * 2)
    tracker = MemoryTracker(image, box, backend=backend)
    moved = cv2.warpAffine(image, cv2.getRotationMatrix2D((160, 120), 35, 0.85), (320, 240))
    result = tracker.update(moved)
    assert result["status"] == "matched"
    assert result["box"] == box
    assert result["score"] == 0.99
    assert result["maskQuality"] == 0.94


def test_absence_cannot_relock_an_unrelated_high_score_mask():
    image = textured_image(42)
    box = [0, 0, 1, 1]
    backend = SegmentationBoundary(
        [(box, 0.99, 0.94), (None, 0.01, 0.2), (box, 0.99, 0.95), (box, 0.99, 0.95)]
    )
    tracker = MemoryTracker(image, box, backend=backend)
    assert tracker.update(textured_image(66)) == {"status": "searching"}
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert not tracker.active
    assert tracker.update(image)["status"] == "matched"
    assert tracker.active


def test_low_quality_prediction_does_not_enter_trusted_memory():
    image = textured_image(42)
    box = [0, 0, 1, 1]
    backend = SegmentationBoundary([(box, 0.99, 0.94), (box, 0.99, 0.3)])
    tracker = MemoryTracker(image, box, backend=backend)
    assert tracker.update(image) == {"status": "searching"}
    assert tracker.outputs["non_cond_frame_outputs"] == {}
    assert tracker.outputs["cond_frame_outputs"][0] == {"frame": 0}


def test_streaming_memory_stays_bounded_without_dropping_original_conditioning():
    image = textured_image(42)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(image, box, backend=SegmentationBoundary([(box, 0.99, 0.94)] * 101))
    for _ in range(100):
        assert tracker.update(image)["status"] == "matched"
    assert tracker.outputs["cond_frame_outputs"] == {0: {"frame": 0}}
    assert len(tracker.outputs["non_cond_frame_outputs"]) <= 16
    assert 100 in tracker.outputs["non_cond_frame_outputs"]
    assert 1 not in tracker.outputs["non_cond_frame_outputs"]


def test_initial_mask_cannot_expand_a_small_selection_to_the_entire_frame():
    with pytest.raises(ValueError):
        MemoryTracker(
            textured_image(42),
            [0.2, 0.2, 0.4, 0.4],
            backend=SegmentationBoundary([([0, 0, 1, 1], 0.99, 0.94)]),
        )


@pytest.mark.parametrize(
    "presence,quality",
    [(float("nan"), 0.9), (0.99, float("nan")), (1.1, 0.9), (0.99, 1.1), (0.8, 0.9), (0.99, 0.4)],
)
def test_invalid_or_uncertain_outputs_never_draw_a_box(presence, quality):
    image = textured_image(42)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(
        image, box, backend=SegmentationBoundary([(box, 0.99, 0.94), (box, presence, quality)])
    )
    assert tracker.update(image) == {"status": "searching"}


def test_dimension_change_discards_camera_memory_before_reacquisition():
    tracker = MemoryTracker(
        textured_image(42), [0, 0, 1, 1], backend=SegmentationBoundary([([0, 0, 1, 1], 0.99, 0.94)])
    )
    assert tracker.update(np.zeros((480, 640, 3), np.uint8)) == {"status": "searching"}
    assert not tracker.active
    assert not tracker.outputs["cond_frame_outputs"]


def test_unverified_acquisition_cannot_seed_memory_for_another_object():
    from matching import Reference

    selected = textured_image(42)
    with pytest.raises(ValueError):
        MemoryTracker(
            textured_image(88),
            [0, 0, 1, 1],
            reference=Reference(selected, [0, 0, 1, 1]),
            backend=SegmentationBoundary([([0, 0, 1, 1], 0.99, 0.94)]),
        )


def test_shared_inference_keeps_camera_state_independent():
    class Boundary:
        def predict(self, image, box, index, outputs):
            box = box if box is not None else outputs["cond_frame_outputs"][0]["box"]
            return SimpleNamespace(box=box, presence=0.99, quality=0.94, memory={"box": box})

    backend = Boundary()
    image = textured_image(42)
    scene = MemoryTracker(image, [0.1, 0.1, 0.4, 0.4], backend=backend)
    target = MemoryTracker(image, [0.5, 0.5, 0.9, 0.9], backend=backend)
    for _ in range(20):
        assert scene.update(image)["box"] == [0.1, 0.1, 0.4, 0.4]
        assert target.update(image)["box"] == [0.5, 0.5, 0.9, 0.9]
        assert scene.update(image)["box"] == [0.1, 0.1, 0.4, 0.4]
    target.update(np.zeros((480, 640, 3), np.uint8))
    assert scene.update(image)["status"] == "matched"
    assert not target.active


def test_blank_camera_frame_cannot_draw_even_a_confident_mask():
    image = textured_image(42)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(image, box, backend=SegmentationBoundary([(box, 0.99, 0.94)] * 2))
    assert tracker.update(np.zeros_like(image)) == {"status": "searching"}
    assert not tracker.active


class AppearanceBoundary:
    def score(self, previous, current):
        return 0.94


def test_brief_recovery_requires_two_consistent_appearance_verified_masks():
    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(
        image,
        box,
        backend=SegmentationBoundary(
            [(box, 0.99, 0.94), (None, 0.01, 0.2), (box, 0.99, 0.94), (box, 0.99, 0.94)]
        ),
        appearance=AppearanceBoundary(),
    )
    original = tracker.reference
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.update(moved) == {"status": "searching"}
    assert tracker.update(moved)["status"] == "matched"
    assert tracker.reference is original
    assert tracker.outputs["cond_frame_outputs"] == {0: {"frame": 0}}


def test_old_recent_appearance_cannot_restore_lock_after_long_absence():
    image = textured_image(42)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(
        image,
        box,
        backend=SegmentationBoundary([(box, 0.99, 0.94)] * 2),
        appearance=AppearanceBoundary(),
    )
    for _ in range(20):
        assert tracker.update(np.zeros_like(image)) == {"status": "searching"}
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert not tracker.active


def test_recent_appearance_cannot_authorize_a_jump_to_another_location():
    image = textured_image(42)
    box = [0, 0, 0.3, 0.3]
    tracker = MemoryTracker(
        image,
        box,
        backend=SegmentationBoundary(
            [(box, 0.99, 0.94), (None, 0.01, 0.2), ([0.6, 0.6, 1, 1], 0.99, 0.94)]
        ),
        appearance=AppearanceBoundary(),
    )
    assert tracker.update(textured_image(66)) == {"status": "searching"}
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert not tracker.active


def test_confident_jump_cannot_poison_memory_or_recent_recovery():
    image = textured_image(42)
    other = textured_image(88)
    selected = [0.05, 0.05, 0.35, 0.4]
    wrong = [0.6, 0.6, 0.95, 0.95]
    tracker = MemoryTracker(
        image,
        selected,
        appearance=AppearanceBoundary(),
        backend=SegmentationBoundary(
            [
                (selected, 0.99, 0.95),
                (wrong, 0.99, 0.95),
                (None, 0.01, 0.2),
                (wrong, 0.99, 0.95),
                (wrong, 0.99, 0.95),
            ]
        ),
    )
    tracker.backend.similarity = lambda *args: 0.99
    trusted = tracker.trusted_crop.copy()
    for _ in range(4):
        assert tracker.update(other) == {"status": "searching"}
    assert tracker.outputs["non_cond_frame_outputs"] == {}
    assert np.array_equal(tracker.trusted_crop, trusted)
    assert tracker.trusted_box == selected


def test_short_recovery_can_use_verified_motion_across_a_pose_change(monkeypatch):
    import memory_tracking

    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    monkeypatch.setattr(memory_tracking, "follow_flow", lambda *args: {"box": box, "score": 0.94})
    tracker = MemoryTracker(
        image,
        box,
        appearance=AppearanceBoundary(),
        backend=SegmentationBoundary(
            [
                (box, 0.99, 0.94),
                (None, 0.01, 0.2),
                (box, 0.99, 0.94),
                (box, 0.99, 0.94),
            ]
        ),
    )
    tracker.appearance.score = lambda *args: 0.6
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.update(moved) == {"status": "searching"}
    assert tracker.update(moved)["status"] == "matched"


@pytest.mark.parametrize("similarity,matched", [(0.75, True), (0.65, False)])
def test_short_recovery_similarity_is_distinct_from_object_presence(similarity, matched):
    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    appearance = AppearanceBoundary()
    appearance.score = lambda *args: similarity
    tracker = MemoryTracker(
        image,
        box,
        appearance=appearance,
        backend=SegmentationBoundary(
            [
                (box, 0.99, 0.94),
                (None, 0.01, 0.2),
                (box, 0.99, 0.94),
                (box, 0.99, 0.94),
            ]
        ),
    )
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.update(moved) == {"status": "searching"}
    result = tracker.update(moved)
    assert (result["status"] == "matched") == matched
    if matched:
        assert result["score"] > 0.8


def test_abrupt_mask_expansion_cannot_poison_memory_or_recovery():
    image = textured_image(42)
    other = textured_image(88)
    box = [0.3, 0.3, 0.7, 0.7]
    expanded = [0, 0, 1, 1]
    tracker = MemoryTracker(
        image,
        box,
        appearance=AppearanceBoundary(),
        backend=SegmentationBoundary(
            [
                (box, 0.99, 0.95),
                (expanded, 0.99, 0.95),
                (None, 0.01, 0.2),
                (expanded, 0.99, 0.95),
                (expanded, 0.99, 0.95),
            ]
        ),
    )
    tracker.backend.similarity = lambda *args: 0.99
    for _ in range(4):
        assert tracker.update(other) == {"status": "searching"}
    assert tracker.trusted_box == box
    assert tracker.outputs["non_cond_frame_outputs"] == {}


def test_partial_view_does_not_erase_recent_full_object_recovery_evidence(monkeypatch):
    import memory_tracking

    image = textured_image(42)
    other = cv2.flip(image, 1)
    full = [0, 0, 1, 1]
    right = [0.5, 0, 1, 1]
    left = [0, 0, 0.5, 1]
    appearance = AppearanceBoundary()
    appearance.score = lambda previous, current: 0.94 if previous.shape[1] > 300 else 0.6
    monkeypatch.setattr(memory_tracking, "follow_flow", lambda *args: None)
    tracker = MemoryTracker(
        image,
        full,
        appearance=appearance,
        backend=SegmentationBoundary(
            [
                (full, 0.99, 0.95),
                (right, 0.99, 0.95),
                (None, 0.01, 0.2),
                (left, 0.99, 0.95),
                (left, 0.99, 0.95),
            ]
        ),
    )
    assert tracker.update(other)["status"] == "matched"
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.update(other) == {"status": "searching"}
    assert tracker.update(other)["status"] == "matched"


def test_two_verified_recovery_observations_can_span_one_uncertain_mask():
    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(
        image,
        box,
        appearance=AppearanceBoundary(),
        backend=SegmentationBoundary(
            [
                (box, 0.99, 0.95),
                (None, 0.01, 0.2),
                (box, 0.99, 0.95),
                (box, 0.9, 0.3),
                (box, 0.99, 0.95),
            ]
        ),
    )
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.update(moved) == {"status": "searching"}
    assert tracker.update(moved) == {"status": "searching"}
    assert tracker.update(moved)["status"] == "matched"


def test_true_absence_between_verified_observations_restarts_confirmation():
    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(
        image,
        box,
        appearance=AppearanceBoundary(),
        backend=SegmentationBoundary(
            [
                (box, 0.99, 0.95),
                (None, 0.01, 0.2),
                (box, 0.99, 0.95),
                (None, 0.01, 0.2),
                (box, 0.99, 0.95),
            ]
        ),
    )
    for frame in [textured_image(88), moved, moved, moved]:
        assert tracker.update(frame) == {"status": "searching"}
    assert not tracker.active


def test_delayed_recovery_observation_cannot_reuse_an_old_confirmation():
    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    now = [0.0]
    tracker = MemoryTracker(
        image,
        box,
        appearance=AppearanceBoundary(),
        clock=lambda: now[0],
        backend=SegmentationBoundary(
            [
                (box, 0.99, 0.95),
                (None, 0.01, 0.2),
                (box, 0.99, 0.95),
                (box, 0.99, 0.95),
                (box, 0.99, 0.95),
            ]
        ),
    )
    now[0] = 0.1
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    now[0] = 0.2
    assert tracker.update(moved) == {"status": "searching"}
    now[0] = 1.3
    assert tracker.update(moved) == {"status": "searching"}
    now[0] = 1.4
    assert tracker.update(moved)["status"] == "matched"


@pytest.mark.parametrize(
    "similarity,matched", [(0.95, True), (0.85, True), (0.8, False), (0.6, False)]
)
def test_short_pose_recovery_can_use_the_selected_mask_memory(similarity, matched):
    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    appearance = AppearanceBoundary()
    appearance.score = lambda *args: 0.6
    backend = SegmentationBoundary(
        [
            (box, 0.99, 0.95),
            (None, 0.01, 0.2),
            (box, 0.99, 0.75),
            (box, 0.99, 0.75),
        ]
    )
    backend.similarity = lambda *args: similarity
    tracker = MemoryTracker(image, box, backend=backend, appearance=appearance)
    assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.update(moved) == {"status": "searching"}
    assert (tracker.update(moved)["status"] == "matched") == matched


@pytest.mark.parametrize(
    "bad",
    [
        ([0, 0, 2, 1], 0.99, 0.95),
        ([0, 0, 0, 0], 0.99, 0.95),
        ([0, 0, 1, 1], 1.1, 0.95),
        ([0, 0, 1, 1], 0.99, 1.1),
        ([0, 0, 1, 1], 0.99, -0.1),
    ],
)
def test_invalid_evidence_clears_pending_recovery_confirmation(bad):
    image = textured_image(42)
    moved = cv2.flip(image, 1)
    box = [0, 0, 1, 1]
    tracker = MemoryTracker(
        image,
        box,
        appearance=AppearanceBoundary(),
        backend=SegmentationBoundary(
            [
                (box, 0.99, 0.95),
                (None, 0.01, 0.2),
                (box, 0.99, 0.95),
                bad,
                (box, 0.99, 0.95),
                (box, 0.99, 0.95),
            ]
        ),
    )
    for frame in [textured_image(88), moved, moved, moved]:
        assert tracker.update(frame) == {"status": "searching"}
    assert tracker.update(moved)["status"] == "matched"


@pytest.mark.parametrize("similarity,matched", [(0.85, True), (0.6, False)])
def test_small_remaining_overlap_uses_recent_mask_evidence(similarity, matched, monkeypatch):
    import memory_tracking

    image = textured_image(42)
    selected = [0.2, 0.1, 0.5, 0.5]
    moved = [0.47, 0.1, 0.77, 0.5]
    backend = SegmentationBoundary([(selected, 0.99, 0.95), (moved, 0.99, 0.95)])
    backend.similarity = lambda *args: similarity
    monkeypatch.setattr(memory_tracking, "follow_flow", lambda *args: None)
    tracker = MemoryTracker(image, selected, backend=backend, appearance=AppearanceBoundary())
    result = tracker.update(textured_image(88))
    assert (result["status"] == "matched") == matched


@pytest.mark.parametrize("similarity,matched", [(0.9, True), (0.8, False), (0.6, False)])
def test_fast_motion_recovery_can_confirm_a_new_position(similarity, matched, monkeypatch):
    import memory_tracking

    image = textured_image(42)
    changed = cv2.flip(image, 1)
    selected = [0.1, 0.2, 0.3, 0.55]
    first = [0.35, 0.2, 0.55, 0.55]
    second = [0.56, 0.2, 0.76, 0.55]
    backend = SegmentationBoundary(
        [(selected, 0.99, 0.95), (first, 0.99, 0.95), (second, 0.99, 0.95)]
    )
    backend.similarity = lambda *args: similarity
    appearance = AppearanceBoundary()
    appearance.score = lambda *args: 0.4
    monkeypatch.setattr(memory_tracking, "follow_flow", lambda *args: None)
    tracker = MemoryTracker(image, selected, backend=backend, appearance=appearance)
    original = tracker.reference
    assert tracker.update(changed) == {"status": "searching"}
    assert tracker.outputs["non_cond_frame_outputs"] == {}
    result = tracker.update(changed)
    assert (result["status"] == "matched") == matched
    assert tracker.reference is original
    if matched:
        assert result["box"] == second
        assert list(tracker.outputs["non_cond_frame_outputs"]) == [2]


def test_fast_motion_recovery_does_not_use_appearance_alone(monkeypatch):
    import memory_tracking

    image = textured_image(42)
    selected = [0.1, 0.2, 0.3, 0.55]
    moved = [0.4, 0.2, 0.6, 0.55]
    monkeypatch.setattr(memory_tracking, "follow_flow", lambda *args: None)
    tracker = MemoryTracker(
        image,
        selected,
        appearance=AppearanceBoundary(),
        backend=SegmentationBoundary(
            [(selected, 0.99, 0.95), (moved, 0.99, 0.95), (moved, 0.99, 0.95)]
        ),
    )
    for _ in range(2):
        assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.outputs["non_cond_frame_outputs"] == {}


def test_fast_motion_confirmation_requires_consistent_mask_memory(monkeypatch):
    import memory_tracking

    image = textured_image(42)
    selected = [0.1, 0.2, 0.3, 0.55]
    first = [0.35, 0.2, 0.55, 0.55]
    second = [0.56, 0.2, 0.76, 0.55]
    backend = SegmentationBoundary(
        [(selected, 0.99, 0.95), (first, 0.99, 0.95), (second, 0.99, 0.95)]
    )
    backend.similarity = lambda candidate, anchor: 0.9 if anchor["frame"] == 0 else 0.4
    monkeypatch.setattr(memory_tracking, "follow_flow", lambda *args: None)
    tracker = MemoryTracker(image, selected, backend=backend, appearance=AppearanceBoundary())
    for _ in range(2):
        assert tracker.update(cv2.flip(image, 1)) == {"status": "searching"}
    assert tracker.outputs["non_cond_frame_outputs"] == {}


def test_fast_recovery_rejects_an_equal_area_unrelated_stripe(monkeypatch):
    import memory_tracking

    image = textured_image(42)
    selected = [0.3, 0.2, 0.4, 0.55]
    stripe = [0, 0.6, 1, 0.635]
    backend = SegmentationBoundary(
        [(selected, 0.99, 0.95), (stripe, 0.99, 0.95), (stripe, 0.99, 0.95)]
    )
    backend.similarity = lambda *args: 0.9
    monkeypatch.setattr(memory_tracking, "follow_flow", lambda *args: None)
    tracker = MemoryTracker(image, selected, backend=backend, appearance=AppearanceBoundary())
    for _ in range(2):
        assert tracker.update(textured_image(88)) == {"status": "searching"}
    assert tracker.outputs["non_cond_frame_outputs"] == {}
