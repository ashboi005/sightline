"""Per-stream hand tracking and fresh alphabet evidence; no temporal model cache."""

import time
from dataclasses import dataclass

import cv2
import numpy as np

from .landmark_pipeline import pixel_features, shared_pipeline
from .model import LandmarkExtractor
from .motion import HandMotionGate
from .types import LandmarkInput, Prediction, RecognitionEvidence, continuity_gap_ms


@dataclass(frozen=True)
class FrameResult:
    hands_detected: int
    partial: Prediction | None = None
    observation: LandmarkInput | None = None


class AlphabetRecognizer:
    def __init__(self, pipeline=None, extractor=None):
        self.pipeline = pipeline if pipeline is not None else shared_pipeline()
        self.extractor = extractor if extractor is not None else LandmarkExtractor()
        self.motion = HandMotionGate()
        self._frame_id = 0
        self.last_tracking_ms = 0.0

    @property
    def vocabulary(self):
        return self.pipeline.vocabulary

    @property
    def model_name(self):
        return self.pipeline.model_name

    @property
    def load_error(self):
        if not self.extractor.available:
            return "MediaPipe Hands is unavailable; run sign:setup"
        return self.pipeline.load_error or (
            None if self.pipeline.loaded else "Alphabet model is not loaded"
        )

    @property
    def confidence_threshold(self):
        return getattr(self.pipeline, "confidence_threshold", 0.85)

    @property
    def spelling_decoder(self):
        return getattr(self.pipeline, "decode_spelling", None)

    def configure_frame_rate(self, fps):
        self.motion.max_gap_ms = continuity_gap_ms(fps)

    def reset(self):
        self.extractor.reset()
        self.motion.reset()

    def close(self):
        self.extractor.close()

    def track(self, jpeg, ts):
        started = time.perf_counter()
        if not jpeg.startswith(b"\xff\xd8"):
            raise ValueError("image is not a valid JPEG")
        image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("image is not a valid JPEG")
        _, hands = self.extractor.extract(image)
        self._frame_id += 1
        observation = None
        if hands:
            points = max(
                self.extractor.last_raw_hands,
                key=lambda hand: float(np.ptp(hand[:, 0]) * np.ptp(hand[:, 1])),
            )
            coordinates = pixel_features(points, image.shape[1], image.shape[0])
            observation = LandmarkInput(
                coordinates, self._frame_id, ts, self.motion.observe(coordinates, ts)
            )
        else:
            self.motion.reset()
        self.last_tracking_ms = (time.perf_counter() - started) * 1000
        return FrameResult(hands, observation=observation)

    def predict(self, frame):
        prediction = self.pipeline.infer(frame) if frame.steady else None
        if prediction is not None and prediction.confidence < self.confidence_threshold:
            prediction = None
        return RecognitionEvidence(prediction, frame.frame_id)
