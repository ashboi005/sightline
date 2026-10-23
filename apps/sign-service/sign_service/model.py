"""MediaPipe hand extraction shared by the alphabet recognition pipeline."""

from __future__ import annotations

import time
from typing import Any

import cv2
import numpy as np

try:
    import mediapipe as mp
except ImportError:  # pragma: no cover - reported by the service setup check
    mp = None  # type: ignore[assignment]


class LandmarkExtractor:
    """Track up to two hands and expose raw landmarks in image coordinates."""

    def __init__(self, max_num_hands: int = 2, static_image_mode: bool = False) -> None:
        self.available = False
        self.detection_mode = "rgb"
        self._next_recovery_at = 0.0
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
            model_complexity=1,
            min_detection_confidence=0.55,
            min_tracking_confidence=0.5,
        )
        self.available = True

    def reset(self) -> None:
        self.detection_mode = "rgb"
        self._next_recovery_at = 0.0
        if self._hands is not None:
            self._hands.reset()
        self.last_raw_hands = []

    def close(self) -> None:
        if self._hands is not None:
            self._hands.close()
            self._hands = None
        self.available = False
        self.last_raw_hands = []

    def extract(self, image: np.ndarray) -> tuple[list[np.ndarray], int]:
        if not self.available or self._hands is None:
            self.last_raw_hands = []
            return [], 0
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        gray = None
        if self.detection_mode == "grayscale":
            gray = cv2.cvtColor(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2RGB)
        result = self._hands.process(gray if gray is not None else rgb)
        now = time.monotonic()
        if not result.multi_hand_landmarks and now >= self._next_recovery_at:
            # Recover from strong camera color casts without changing coordinates,
            # detector thresholds or the successful RGB path. Empty scenes get at
            # most one alternate attempt per half second.
            self._next_recovery_at = now + 0.5
            if self.detection_mode == "rgb":
                alternate = cv2.cvtColor(
                    cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2RGB
                )
                alternate_mode = "grayscale"
            else:
                alternate = rgb
                alternate_mode = "rgb"
            recovered = self._hands.process(alternate)
            if recovered.multi_hand_landmarks:
                result = recovered
                self.detection_mode = alternate_mode
        raw = [
            np.array([[point.x, point.y, point.z] for point in hand.landmark], dtype=np.float32)
            for hand in result.multi_hand_landmarks or []
        ]
        raw.sort(key=lambda hand: float(hand[0, 0]))
        self.last_raw_hands = [hand.copy() for hand in raw[:2]]
        return self.last_raw_hands, len(self.last_raw_hands)

    def draw_last_landmarks(self, image: np.ndarray) -> np.ndarray:
        preview = image.copy()
        if not self.last_raw_hands or mp is None:
            return preview
        height, width = preview.shape[:2]
        connections = getattr(getattr(mp.solutions, "hands", None), "HAND_CONNECTIONS", ())
        for hand_index, hand in enumerate(self.last_raw_hands, start=1):
            points = np.array(
                [
                    [
                        int(np.clip(point[0] * width, 0, width - 1)),
                        int(np.clip(point[1] * height, 0, height - 1)),
                    ]
                    for point in hand
                ],
                dtype=np.int32,
            )
            for start, end in connections:
                cv2.line(
                    preview, tuple(points[start]), tuple(points[end]), (0, 220, 0), 2, cv2.LINE_AA
                )
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
