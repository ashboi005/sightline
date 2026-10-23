import os
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from sightline_speaker.faces import FaceObservation
from sightline_speaker.live_faces import LiveFaces


def observation(timestamp, box):
    return FaceObservation(timestamp, box, np.zeros((5, 2)), np.zeros(2))


def textured_scene():
    return np.random.default_rng(0).integers(0, 256, (100, 100, 3), dtype=np.uint8)


def detector_fixture(monkeypatch, crop_has_face=True):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(detect=lambda image: None, close=lambda: None)

    def observations(_, width, height, timestamp):
        if width == 100:
            right = observation(timestamp, (0.7, 0.2, 0.2, 0.4))
            if timestamp == 0:
                return [observation(timestamp, (0.2, 0.2, 0.2, 0.4)), right]
            return [right]
        return [observation(timestamp, (0.25, 0.25, 0.5, 0.5))] if crop_has_face else []

    monkeypatch.setattr("sightline_speaker.live_faces.detector_observations", observations)
    return faces


def test_a_fresh_crop_detection_preserves_identity_through_a_full_scene_miss(monkeypatch):
    faces = detector_fixture(monkeypatch)
    image = textured_scene()
    faces.detect(image, 0)
    selected = min(faces.tracks.values(), key=lambda track: track.observations[-1].box[0]).id
    faces.detect(image, 0.2)
    assert selected in faces.tracks
    assert faces.tracks[selected].observations[-1].timestamp == 0.2
    assert len(faces.tracks) == 2
    faces.close()


def test_a_missing_face_is_retired_when_both_full_scene_and_crop_fail(monkeypatch):
    faces = detector_fixture(monkeypatch, crop_has_face=False)
    image = np.zeros((100, 100, 3), np.uint8)
    faces.detect(image, 0)
    selected = min(faces.tracks.values(), key=lambda track: track.observations[-1].box[0]).id
    faces.detect(image, 0.2)
    assert selected not in faces.tracks
    faces.close()


def test_duplicate_landmarks_do_not_replace_the_location_identity(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(detect=lambda image: None, close=lambda: None)

    def observations(_, width, height, timestamp):
        original = observation(timestamp, (0.2, 0.2, 0.2, 0.4))
        right = observation(timestamp, (0.7, 0.2, 0.2, 0.4))
        duplicate = observation(timestamp, (0.205, 0.205, 0.2, 0.4))
        duplicate.anchors += 1
        return [original, right] if timestamp == 0 else [right, duplicate, original]

    monkeypatch.setattr("sightline_speaker.live_faces.detector_observations", observations)
    image = textured_scene()
    faces.detect(image, 0)
    selected = min(faces.tracks.values(), key=lambda t: t.observations[-1].box[0]).id
    faces.detect(image, 0.2)
    assert selected in faces.tracks
    assert len(faces.tracks) == 2
    assert faces.tracks[selected].observations[-1].timestamp == 0.2
    faces.close()


def test_overlapping_faces_with_distinct_landmarks_remain_ambiguous(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(detect=lambda image: None, close=lambda: None)

    def observations(_, width, height, timestamp):
        first = observation(timestamp, (0.2, 0.2, 0.2, 0.4))
        second = observation(timestamp, (0.205, 0.205, 0.2, 0.4))
        second.anchors += 10
        return [first, second]

    monkeypatch.setattr("sightline_speaker.live_faces.detector_observations", observations)
    faces.detect(np.zeros((100, 100, 3), np.uint8), 0)
    assert len(faces.tracks) == 2
    faces.close()


def test_face_evidence_covers_accepted_backlog_until_audio_consumes_it(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: [observation(timestamp, (0.2, 0.2, 0.2, 0.4))],
    )
    image = textured_scene()
    try:
        for timestamp in np.arange(0, 6.01, 0.2):
            faces.detect(image, float(timestamp), retain_from=0)
        track = next(iter(faces.tracks.values()))
        assert track.observations[0].timestamp == 0
        faces.detect(image, 6.2, retain_from=5)
        assert track.observations[0].timestamp >= 2.7
    finally:
        faces.close()


def textured_face(seed=1, offset=0):
    """A repeatable texture exercises real image tracking, not face recognition."""
    image = np.zeros((160, 200, 3), np.uint8)
    texture = np.random.default_rng(seed).integers(35, 220, (80, 60, 3), dtype=np.uint8)
    image[32:112, 40 + offset : 100 + offset] = texture
    return image


def test_verified_image_motion_preserves_selection_across_a_detector_miss(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: (
            [] if timestamp == 0.2 else [observation(timestamp, (0.2, 0.2, 0.3, 0.5))]
        ),
    )
    try:
        faces.detect(textured_face(), 0)
        selected = next(iter(faces.tracks))
        faces.detect(cv2.GaussianBlur(textured_face(), (3, 3), 0), 0.2)
        assert selected in faces.tracks
        # Retaining identity must never manufacture landmark or mouth evidence.
        assert [o.timestamp for o in faces.tracks[selected].observations] == [0]
        faces.detect(textured_face(), 0.4)
        assert list(faces.tracks) == [selected]
        assert [o.timestamp for o in faces.tracks[selected].observations] == [0, 0.4]
    finally:
        faces.close()


def test_a_new_face_in_the_same_box_cannot_inherit_selection(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: [observation(timestamp, (0.2, 0.2, 0.3, 0.5))],
    )
    try:
        faces.detect(textured_face(seed=1), 0)
        selected = next(iter(faces.tracks))
        faces.detect(textured_face(seed=2), 0.2)
        assert selected not in faces.tracks
        assert len(faces.tracks) == 1
    finally:
        faces.close()


def test_flow_does_not_keep_selection_after_texture_is_occluded(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: (
            [] if timestamp == 0.2 else [observation(timestamp, (0.2, 0.2, 0.3, 0.5))]
        ),
    )
    try:
        faces.detect(textured_face(), 0)
        selected = next(iter(faces.tracks))
        faces.detect(np.zeros((160, 200, 3), np.uint8), 0.2)
        assert selected not in faces.tracks
        faces.detect(textured_face(seed=2), 0.4)
        assert selected not in faces.tracks
    finally:
        faces.close()


def test_verified_face_motion_bridges_a_detection_gap(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: (
            []
            if timestamp == 0.2
            else [observation(timestamp, (0.3 if timestamp == 0.4 else 0.2, 0.2, 0.3, 0.5))]
        ),
    )
    try:
        faces.detect(textured_face(), 0)
        selected = next(iter(faces.tracks))
        faces.detect(textured_face(offset=10), 0.2)
        assert selected in faces.tracks
        faces.detect(textured_face(offset=20), 0.4)
        assert list(faces.tracks) == [selected]
        assert faces.tracks[selected].observations[-1].box == (0.3, 0.2, 0.3, 0.5)
    finally:
        faces.close()


def test_flow_cannot_extend_the_deadline_without_real_face_observations(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: (
            [observation(timestamp, (0.2, 0.2, 0.3, 0.5))] if timestamp in (0, 1.0) else []
        ),
    )
    try:
        faces.detect(textured_face(), 0)
        selected = next(iter(faces.tracks))
        for timestamp in (0.2, 0.4):
            faces.detect(textured_face(), timestamp)
            assert selected in faces.tracks
        faces.detect(textured_face(), 0.8)
        assert selected not in faces.tracks
        faces.detect(textured_face(), 1.0)
        assert selected not in faces.tracks
    finally:
        faces.close()


def test_overlapping_ambiguous_detections_retire_even_a_verified_identity(monkeypatch):
    faces = LiveFaces()
    faces.detector = SimpleNamespace(close=lambda: None)

    def observe(image, timestamp, region):
        original = observation(timestamp, (0.2, 0.2, 0.3, 0.5))
        return (
            [original, observation(timestamp, (0.21, 0.2, 0.3, 0.5))]
            if timestamp == 0.2
            else [original]
        )

    monkeypatch.setattr(faces, "_observe", observe)
    try:
        faces.detect(textured_face(), 0)
        selected = next(iter(faces.tracks))
        faces.detect(textured_face(), 0.2)
        assert selected not in faces.tracks
        faces.detect(textured_face(), 0.4)
        assert selected not in faces.tracks
    finally:
        faces.close()


@pytest.mark.parametrize("exposed_width,newcomer_left", [(22, 68), (60, 100)])
def test_tracked_pixels_cannot_select_an_unsupported_overlapping_newcomer(
    monkeypatch, exposed_width, newcomer_left
):
    first = np.full((160, 200, 3), 110, np.uint8)
    first[32:112, 40 : 40 + exposed_width] = np.random.default_rng(1).integers(
        0, 256, (80, exposed_width, 3), dtype=np.uint8
    )
    second = first.copy()
    second[32:112, newcomer_left:128] = np.random.default_rng(2).integers(
        0, 256, (80, 128 - newcomer_left, 3), dtype=np.uint8
    )
    faces = LiveFaces()
    monkeypatch.setattr(faces, "initialize", lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: [
            observation(timestamp, (0.2 if timestamp == 0 else 0.34, 0.2, 0.3, 0.5))
        ],
    )
    try:
        faces.detect(first, 0)
        selected = next(iter(faces.tracks))
        faces.detect(second, 0.2)
        assert selected not in faces.tracks
    finally:
        faces.close()


@pytest.mark.parametrize("exposed_height", [24, 80])
def test_an_original_eye_band_cannot_select_a_newcomer_above_it(monkeypatch, exposed_height):
    first = np.full((160, 200, 3), 110, np.uint8)
    first[32 : 32 + exposed_height, 40:100] = np.random.default_rng(1).integers(
        0, 256, (exposed_height, 60, 3), dtype=np.uint8
    )
    second = first.copy()
    second[0:32, 40:100] = np.random.default_rng(2).integers(0, 256, (32, 60, 3), dtype=np.uint8)
    faces = LiveFaces()
    monkeypatch.setattr(faces, "initialize", lambda: None)
    monkeypatch.setattr(
        faces,
        "_observe",
        lambda image, timestamp, region: [
            observation(timestamp, (0.2, 0.2 if timestamp == 0 else 0.0, 0.3, 0.5))
        ],
    )
    try:
        faces.detect(first, 0)
        selected = next(iter(faces.tracks))
        faces.detect(second, 0.2)
        assert selected not in faces.tracks
    finally:
        faces.close()


def test_reference_debate_preserves_the_right_track_through_all_real_frames():
    reference = os.environ.get("SIGHTLINE_FACE_REFERENCE_VIDEO")
    if not reference or not Path(reference).is_file():
        pytest.skip("Set SIGHTLINE_FACE_REFERENCE_VIDEO to the local low-resolution debate sample")
    video = cv2.VideoCapture(reference)
    faces = LiveFaces()
    selected = None
    count = 0
    try:
        fps = video.get(cv2.CAP_PROP_FPS)
        assert fps > 0
        while True:
            success, frame = video.read()
            if not success:
                break
            encoded, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            assert encoded
            image = cv2.cvtColor(cv2.imdecode(jpeg, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
            faces.detect(image, count / fps)
            if selected is None:
                selected = max(
                    faces.tracks.values(), key=lambda track: track.observations[-1].box[0]
                ).id
            assert selected in faces.tracks, f"Selected right face was lost at {count / fps:.3f}s"
            assert faces.tracks[selected].observations[-1].box[0] > 0.65
            count += 1
        assert count >= 400
    finally:
        faces.close()
        video.release()
