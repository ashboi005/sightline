"""Color recovery at the external MediaPipe boundary, without camera hardware."""

from types import SimpleNamespace

import numpy as np

from sign_service import model


def hand_result():
    points = [SimpleNamespace(x=0.2 + i / 100, y=0.3 + i / 100, z=0) for i in range(21)]
    return SimpleNamespace(multi_hand_landmarks=[SimpleNamespace(landmark=points)])


EMPTY = SimpleNamespace(multi_hand_landmarks=None)


class ColorSensitiveGraph:
    def __init__(self, **kwargs):
        self.calls = 0

    def process(self, image):
        self.calls += 1
        gray = np.array_equal(image[..., 0], image[..., 1]) and np.array_equal(
            image[..., 1], image[..., 2]
        )
        return hand_result() if gray else EMPTY

    def reset(self):
        pass

    def close(self):
        pass


def test_color_cast_recovers_hand_and_keeps_landmarks_in_original_coordinates(monkeypatch):
    monkeypatch.setattr(model.mp.solutions.hands, "Hands", ColorSensitiveGraph)
    extractor = model.LandmarkExtractor()
    image = np.zeros((80, 120, 3), np.uint8)
    image[..., 0] = 200
    try:
        _, count = extractor.extract(image)
        assert count == 1
        np.testing.assert_allclose(extractor.last_raw_hands[0][0], [0.2, 0.3, 0])
        assert extractor.detection_mode == "grayscale"
        # Successful recovered tracking uses one inference on subsequent frames.
        calls = extractor._hands.calls
        assert extractor.extract(image)[1] == 1
        assert extractor._hands.calls == calls + 1
        extractor.reset()
        assert extractor.detection_mode == "rgb"
    finally:
        extractor.close()


def test_empty_frames_do_not_trigger_unbounded_recovery_inference(monkeypatch):
    class EmptyGraph(ColorSensitiveGraph):
        def process(self, image):
            self.calls += 1
            return EMPTY

    monkeypatch.setattr(model.mp.solutions.hands, "Hands", EmptyGraph)
    monkeypatch.setattr(model.time, "monotonic", lambda: 10.0)
    extractor = model.LandmarkExtractor()
    try:
        image = np.zeros((80, 120, 3), np.uint8)
        for _ in range(10):
            assert extractor.extract(image)[1] == 0
        # One alternate attempt, not two model passes on every empty frame.
        assert extractor._hands.calls == 11
    finally:
        extractor.close()


def test_normal_color_tracking_does_not_run_an_alternate_pass(monkeypatch):
    class NormalGraph(ColorSensitiveGraph):
        def process(self, image):
            self.calls += 1
            return hand_result()

    monkeypatch.setattr(model.mp.solutions.hands, "Hands", NormalGraph)
    extractor = model.LandmarkExtractor()
    try:
        assert extractor.extract(np.zeros((80, 120, 3), np.uint8))[1] == 1
        assert extractor._hands.calls == 1
        assert extractor.detection_mode == "rgb"
    finally:
        extractor.close()
