from types import SimpleNamespace

import numpy as np

from sightline_speaker.faces import FaceObservation
from sightline_speaker.live_faces import LiveFaces


def observation(timestamp, box):
    return FaceObservation(timestamp, box, np.zeros((5, 2)), np.zeros(2))


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
    image = np.zeros((100, 100, 3), np.uint8)
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
    image = np.zeros((100, 100, 3), np.uint8)
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
    image = np.zeros((100, 100, 3), np.uint8)
    try:
        for timestamp in np.arange(0, 6.01, 0.2):
            faces.detect(image, float(timestamp), retain_from=0)
        track = next(iter(faces.tracks.values()))
        assert track.observations[0].timestamp == 0
        faces.detect(image, 6.2, retain_from=5)
        assert track.observations[0].timestamp >= 2.7
    finally:
        faces.close()
