import numpy as np

from sign_service.alphabet_recognizer import AlphabetRecognizer
from sign_service.decoding import PhraseDecoder
from sign_service.types import Prediction


def test_forming_handshape_is_suppressed_even_when_classifier_keeps_same_label():
    import cv2

    class Extractor:
        available = True
        def extract(self, image):
            return None, 1
        def reset(self):
            pass
        def close(self):
            pass

    class Pipeline:
        confidence_threshold = 0.15
        def infer(self, frame):
            return Prediction("A", 0.8, "FINGERSPELL")

    extractor = Extractor()
    recognizer = AlphabetRecognizer(Pipeline(), extractor)
    decoder = PhraseDecoder()
    image = np.zeros((480, 640, 3), np.uint8)
    jpeg = cv2.imencode(".jpg", image)[1].tobytes()
    base = np.arange(63, dtype=np.float32).reshape(21, 3) / 200
    try:
        for index in range(24):
            points = base.copy()
            points[8, 0] += 0.15 if index % 2 else 0
            extractor.last_raw_hands = [points]
            frame = recognizer.track(jpeg, index * 100)
            evidence = recognizer.predict(frame.observation)
            decoder.prediction(evidence.prediction, evidence.observation, index * 100)
        assert decoder.letters == []
        for index in range(24, 37):
            extractor.last_raw_hands = [base.copy()]
            frame = recognizer.track(jpeg, index * 100)
            evidence = recognizer.predict(frame.observation)
            decoder.prediction(evidence.prediction, evidence.observation, index * 100)
        assert [letter for letter, _ in decoder.letters] == ["A"]
        recognizer.reset()
        frame = recognizer.track(jpeg, 5000)
        assert recognizer.predict(frame.observation).prediction is None
    finally:
        recognizer.close()


def test_one_fps_steady_hand_uses_configured_continuity_window():
    from sign_service.motion import HandMotionGate

    gate = HandMotionGate(max_gap_ms=2000)
    decoder = PhraseDecoder(max_evidence_gap_ms=2000)
    coordinates = np.arange(42, dtype=np.float32) / 42
    for index in range(5):
        steady = gate.observe(coordinates, index * 1000)
        decoder.prediction(
            Prediction("A", 0.8, "FINGERSPELL") if steady else None,
            index, index * 1000,
        )
    assert [letter for letter, _ in decoder.letters] == ["A"]
