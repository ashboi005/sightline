"""MediaPipe hand extraction shared by the pretrained Hugging Face pipeline."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable

import cv2
import numpy as np

try:
    import mediapipe as mp
except ImportError:  # pragma: no cover - reported by the service setup check
    mp = None  # type: ignore[assignment]


DEMO_DYNAMIC_SIGNS = [
    "PLEASE",
    "REPEAT",
    "FORMULA",
    "QUESTION",
    "MEANING",
    "WHAT",
    "SLOW",
    "BOARD",
    "WRITE",
    "AGAIN",
    "HELLO",
    "ME",
    "NAME",
    "THANK-YOU",
]

FIXTURE_VOCABULARY = [
    "HELLO", "THANK-YOU", "PLEASE", "SORRY", "YES", "NO", "QUESTION", "WHAT", "WHY", "HOW", "WHERE",
    "REPEAT", "AGAIN", "SLOW", "UNDERSTAND", "NOT", "FORMULA", "BOARD", "WRITE", "MEANING", "EXAMPLE",
    "ME", "YOU", "NAME", "HELP", "KCL", "KVL", "RIA", "OHM",
]

VOCABULARY = list(dict.fromkeys([*FIXTURE_VOCABULARY, *DEMO_DYNAMIC_SIGNS, *list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")]))


def canonical_gloss(label: str) -> str:
    """Convert model labels to the contract's uppercase gloss form."""

    return label.strip().upper().replace("_", "-")


def _normalise_hand(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32).reshape(21, 3)
    points = points - points[0]
    palm_distances = np.linalg.norm(points[[5, 9, 13, 17]], axis=1)
    scale = float(np.max(palm_distances)) if palm_distances.size else 0.0
    if not math.isfinite(scale) or scale < 1e-6:
        scale = float(np.max(np.linalg.norm(points, axis=1)))
    if not math.isfinite(scale) or scale < 1e-6:
        scale = 1.0
    return points / scale


def normalise_landmarks(raw_hands: Iterable[np.ndarray]) -> tuple[np.ndarray, int]:
    """Return a fixed two-hand tensor for status/diagnostic consumers."""

    hands = [np.asarray(hand, dtype=np.float32).reshape(21, 3) for hand in raw_hands][:2]
    hands.sort(key=lambda hand: float(hand[0, 0]))
    result = np.zeros((2, 21, 3), dtype=np.float32)
    for index, hand in enumerate(hands):
        result[index] = _normalise_hand(hand)
    return result, len(hands)


class LandmarkExtractor:
    """Decode JPEGs and track up to two MediaPipe Hands."""

    def __init__(self, max_num_hands: int = 2, static_image_mode: bool = False) -> None:
        self.available = False
        self._hands: Any = None
        self.last_raw_hands: list[np.ndarray] = []
        if mp is None:
            return
        hands_module = getattr(getattr(mp, "solutions", None), "hands", None)
        if hands_module is None:
            try:
                from mediapipe.python.solutions import hands as hands_module  # type: ignore
            except (ImportError, ModuleNotFoundError):
                hands_module = None
        if hands_module is None:
            return
        self._hands = hands_module.Hands(
            static_image_mode=static_image_mode,
            max_num_hands=max_num_hands,
            model_complexity=0,
            min_detection_confidence=0.55,
            min_tracking_confidence=0.5,
        )
        self.available = True

    def close(self) -> None:
        if self._hands is not None:
            self._hands.close()
            self._hands = None
        self.available = False
        self.last_raw_hands = []

    def extract(self, image: np.ndarray) -> tuple[np.ndarray, int]:
        if not self.available or self._hands is None:
            self.last_raw_hands = []
            return np.zeros((2, 21, 3), dtype=np.float32), 0
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        result = self._hands.process(rgb)
        raw = [
            np.array([[point.x, point.y, point.z] for point in hand.landmark], dtype=np.float32)
            for hand in result.multi_hand_landmarks or []
        ]
        raw.sort(key=lambda hand: float(hand[0, 0]))
        self.last_raw_hands = [hand.copy() for hand in raw[:2]]
        return normalise_landmarks(raw)

    def draw_last_landmarks(self, image: np.ndarray) -> np.ndarray:
        preview = image.copy()
        if not self.last_raw_hands or mp is None:
            return preview
        height, width = preview.shape[:2]
        connections = getattr(getattr(mp.solutions, "hands", None), "HAND_CONNECTIONS", ())
        for hand_index, hand in enumerate(self.last_raw_hands, start=1):
            points = np.array(
                [
                    [int(np.clip(point[0] * width, 0, width - 1)), int(np.clip(point[1] * height, 0, height - 1))]
                    for point in hand
                ],
                dtype=np.int32,
            )
            for start, end in connections:
                cv2.line(preview, tuple(points[start]), tuple(points[end]), (0, 220, 0), 2, cv2.LINE_AA)
            for point in points:
                cv2.circle(preview, tuple(point), 4, (0, 255, 255), -1, cv2.LINE_AA)
            x, y, box_width, box_height = cv2.boundingRect(points)
            cv2.rectangle(preview, (x, y), (x + box_width, y + box_height), (255, 180, 0), 2)
            cv2.putText(
                preview,
                f"HAND {hand_index}",
                (x, max(20, y - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 180, 0),
                2,
                cv2.LINE_AA,
            )
        return preview

    def process(self, jpeg: bytes) -> tuple[np.ndarray, int]:
        encoded = np.frombuffer(jpeg, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("image is not a valid JPEG")
        return self.extract(image)


@dataclass(frozen=True)
class Prediction:
    gloss: str
    confidence: float
    kind: str
    source: str = "hf-model"
