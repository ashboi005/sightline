import pytest

from sign_service.alphabet_recognizer import AlphabetRecognizer
from sign_service.types import LandmarkInput, Prediction


class Extractor:
    available = True
    last_raw_hands = []

    def extract(self, image):
        import numpy as np

        self.last_raw_hands = [np.arange(63, dtype=np.float32).reshape(21, 3) / 200]
        return np.zeros((2, 21, 3)), 1

    def reset(self):
        pass

    def close(self):
        self.available = False


class Models:
    vocabulary = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    model_name = "test"
    load_error = None
    loaded = True

    def infer(self, frame):
        return Prediction("X", 0.9, "FINGERSPELL") if frame.ts < 500 else None


def jpeg():
    import cv2
    import numpy as np

    return cv2.imencode(".jpg", np.zeros((32, 32, 3), dtype=np.uint8))[1].tobytes()


def test_stream_trackers_are_independent_while_weights_are_shared():
    models = Models()
    a, b = AlphabetRecognizer(models, Extractor()), AlphabetRecognizer(models, Extractor())
    try:
        a.track(jpeg(), 1000)
        assert a._frame_id == 1 and b._frame_id == 0
        b.reset()
        assert a._frame_id == 1
        assert a.pipeline is b.pipeline
        assert a.extractor is not b.extractor
    finally:
        a.close()
        b.close()


def test_invalid_jpeg_does_not_advance_tracking_state():
    recognizer = AlphabetRecognizer(Models(), Extractor())
    try:
        with pytest.raises(ValueError, match="JPEG"):
            recognizer.track(b"invalid", 1000)
        assert recognizer._frame_id == 0
    finally:
        recognizer.close()


def test_every_prediction_is_fresh_and_abstention_does_not_reuse_a_cache():
    recognizer = AlphabetRecognizer(Models(), Extractor())
    try:
        first = recognizer.predict(LandmarkInput(None, 1, 0))
        second = recognizer.predict(LandmarkInput(None, 2, 100))
        assert first.prediction.gloss == "X"
        assert first.observation == 1 and second.observation == 2
        assert recognizer.predict(LandmarkInput(None, 3, 600)).prediction is None
    finally:
        recognizer.close()


def test_tracker_sees_full_frame_and_produces_normalized_landmark_features():
    import cv2
    import numpy as np

    class RecordingExtractor(Extractor):
        def extract(self, image):
            self.seen = image.copy()
            return super().extract(image)

    extractor = RecordingExtractor()
    recognizer = AlphabetRecognizer(Models(), extractor)
    try:
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        jpeg = cv2.imencode(".jpg", image)[1].tobytes()
        result = recognizer.track(jpeg, 0)
        assert extractor.seen.shape == (480, 640, 3)
        assert result.observation.features.shape == (42,)
        assert np.isfinite(result.observation.features).all()
        assert abs(result.observation.features).max() == 1
    finally:
        recognizer.close()
