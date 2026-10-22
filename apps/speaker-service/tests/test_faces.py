import importlib

import numpy as np
import pytest


def face_api():
    try:
        return importlib.import_module("sightline_speaker.faces")
    except ModuleNotFoundError:
        pytest.fail("stable face tracks are not implemented")


def test_overlapping_ambiguous_faces_do_not_inherit_selected_id():
    assignments = face_api().associate_boxes(
        {"selected": (0.1, 0.1, 0.3, 0.3)},
        [(0.09, 0.1, 0.3, 0.3), (0.11, 0.1, 0.3, 0.3)],
    )
    assert assignments == [None, None]


def test_spatially_distinct_faces_keep_ids():
    assignments = face_api().associate_boxes(
        {"left": (0.1, 0.1, 0.2, 0.3), "right": (0.7, 0.1, 0.2, 0.3)},
        [(0.71, 0.1, 0.2, 0.3), (0.11, 0.1, 0.2, 0.3)],
    )
    assert assignments == ["right", "left"]


def test_jump_to_another_person_does_not_reuse_identity():
    assert face_api().associate_boxes(
        {"selected": (0.1, 0.1, 0.2, 0.3)}, [(0.7, 0.1, 0.2, 0.3)]
    ) == [None]


def test_border_crop_contains_no_wrapped_pixels():
    image = np.arange(100, dtype=np.uint8).reshape(10, 10)
    crop = face_api().crop_square(image, (-1, -1), 6)
    assert crop.shape == (6, 6)
    assert crop[0, 0] == 0
    assert crop[-1, -1] == 11


def test_degraded_frame_normalization_matches_visual_training():
    assert np.isclose(
        face_api().normalize_mouth(np.array([[0]], dtype=np.uint8))[0, 0], -0.421 / 0.165
    )


def test_face_runtime_does_not_abort_the_host_process():
    import subprocess
    import sys

    script = """
from sightline_speaker.faces import track_faces
from sightline_speaker.media import DecodedMedia
from pathlib import Path
import numpy as np
media = DecodedMedia(
    Path("unused"), np.zeros(1600), [np.zeros((64,64,3), dtype=np.uint8)],
    np.array([0.0]), 64, 64, 0.1,
)
track_faces(media)
"""
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-2000:]


def test_unverified_detector_dropout_requires_reacquisition():
    tracker = face_api().FaceAssociator()
    original = tracker.update([(0.1, 0.1, 0.2, 0.3)], 0.0)[0]
    assert tracker.update([], 0.15) == []
    assert tracker.update([(0.11, 0.1, 0.2, 0.3)], 0.3)[0] != original


def test_expired_face_cannot_inherit_previous_selection():
    tracker = face_api().FaceAssociator()
    original = tracker.update([(0.1, 0.1, 0.2, 0.3)], 0.0)[0]
    assert tracker.update([(0.1, 0.1, 0.2, 0.3)], 0.7)[0] != original


def test_manual_region_must_fit_the_image():
    with pytest.raises(ValueError, match="region"):
        face_api().validate_region((0.9, 0.1, 0.2, 0.3))


def test_retired_ambiguous_track_cannot_reappear_over_new_track():
    tracker = face_api().FaceAssociator()
    first = tracker.update([(0.1, 0.1, 0.1, 0.1)], 0.0)[0]
    replacement = tracker.update([(0.14, 0.1, 0.13, 0.13)], 0.1)[0]
    assert replacement != first
    assert tracker.update([(0.1, 0.1, 0.11, 0.11)], 0.2) == [replacement]


def test_people_exchanging_positions_during_occlusion_cannot_inherit_selection():
    tracker = face_api().FaceAssociator()
    left, right = (0.1, 0.1, 0.2, 0.3), (0.7, 0.1, 0.2, 0.3)
    before_people = ["alice", "bob"]
    before_ids = dict(zip(before_people, tracker.update([left, right], 0.0), strict=True))
    tracker.update([], 0.15)
    after_people = ["bob", "alice"]
    after_ids = dict(zip(after_people, tracker.update([left, right], 0.3), strict=True))
    assert set(before_ids.values()).isdisjoint(after_ids.values())


def test_one_occluded_person_is_retired_without_disrupting_visible_person():
    tracker = face_api().FaceAssociator()
    left, right = (0.1, 0.1, 0.2, 0.3), (0.7, 0.1, 0.2, 0.3)
    alice, bob = tracker.update([left, right], 0.0)
    assert tracker.update([right], 0.15) == [bob]
    returning, visible = tracker.update([left, right], 0.3)
    assert returning != alice
    assert visible == bob
