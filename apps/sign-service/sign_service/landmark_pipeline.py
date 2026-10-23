"""One alphabet classifier trained on public landmarks; numeric-only CPU inference."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from threading import RLock

import numpy as np

from .types import Prediction

ASSETS = Path(__file__).parent / "assets/landmark_forest"
MODEL_HASH = "ff2271b8f1055b17994ffeb9e27a65c9a8f9d34e5e139ffb88d05d1d0f130076"
PAIR_I, PAIR_J = np.triu_indices(21, k=1)


def pixel_features(landmarks, width, height):
    points = np.asarray(landmarks, dtype=np.float32).reshape(21, 3)
    if not np.isfinite(points).all():
        raise ValueError("Hand landmarks must be finite")
    xy = points[:, :2] * np.array([width, height], dtype=np.float32)
    xy -= xy[0]
    scale = float(np.abs(xy).max())
    if scale < 1e-6:
        raise ValueError("Degenerate hand landmarks")
    return (xy / scale).reshape(42)


def forest_features(coordinates):
    xy = np.asarray(coordinates, dtype=np.float32).reshape(21, 2)
    scale = max(float(np.linalg.norm(xy[9])), 1e-6)
    distances = np.linalg.norm(xy[PAIR_I] - xy[PAIR_J], axis=1) / scale
    return np.concatenate([xy.reshape(42), distances]).astype(np.float32)


class NumericForest:
    def __init__(self, arrays):
        self.roots = arrays["roots"].copy()
        self.feature = arrays["feature"].copy()
        self.threshold = arrays["threshold"].copy()
        self.left = arrays["left"].copy()
        self.right = arrays["right"].copy()
        self.probabilities = arrays["probabilities"].copy()
        self.classes = arrays["classes"].copy()

    def predict_proba(self, features):
        nodes = self.roots.copy()
        for _ in range(64):
            split = self.feature[nodes]
            active = split >= 0
            if not active.any():
                return self.probabilities[nodes].mean(axis=0)
            current = nodes[active]
            choose_left = features[split[active]] <= self.threshold[current]
            nodes[active] = np.where(choose_left, self.left[current], self.right[current])
        raise RuntimeError("Forest exceeded its validated depth")


class LandmarkPipeline:
    confidence_threshold = 0.15

    def __init__(self):
        self.model = None
        self.loaded = False
        self.load_error = None
        self.device = "cpu"
        self._lock = RLock()
        self.language_decoder = None

    @property
    def model_name(self):
        return "sightline/public-landmark-forest@ff2271b8+english-repeat-decoder"

    @property
    def vocabulary(self):
        return list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") if self.loaded else []

    def ensure_loaded(self):
        with self._lock:
            if self.loaded or self.load_error:
                return
            try:
                from .spelling_language import RepeatAwareEnglishDecoder

                path = ASSETS / "forest.npz"
                with path.open("rb") as source:
                    if hashlib.file_digest(source, "sha256").hexdigest() != MODEL_HASH:
                        raise ValueError("Alphabet model hash mismatch")
                metadata = json.loads((ASSETS / "metadata.json").read_text(encoding="utf-8"))
                if metadata["acceptance_video_used_for_training"]:
                    raise ValueError("Acceptance video must not be training data")
                with np.load(path, allow_pickle=False) as arrays:
                    self.model = NumericForest(arrays)
                if self.model.classes.tolist() != list(range(26)):
                    raise ValueError("Alphabet model must support exactly A-Z")
                self.language_decoder = RepeatAwareEnglishDecoder()
                self.loaded = True
            except Exception as error:
                self.load_error = f"Could not load landmark alphabet model: {error}"
                self.close()

    def infer(self, frame):
        if not self.loaded:
            raise RuntimeError(self.load_error or "Alphabet model is not loaded")
        with self._lock:
            scores = self.model.predict_proba(forest_features(frame.features))
        index = int(scores.argmax())
        return Prediction(
            chr(65 + int(self.model.classes[index])),
            float(scores[index]),
            "FINGERSPELL",
            "public-landmark-forest",
        )

    def decode_spelling(self, raw):
        return self.language_decoder.decode(raw)

    def close(self):
        self.model = None
        self.language_decoder = None
        self.loaded = False


_SHARED_PIPELINE = None


def shared_pipeline():
    global _SHARED_PIPELINE
    if _SHARED_PIPELINE is None:
        _SHARED_PIPELINE = LandmarkPipeline()
    return _SHARED_PIPELINE
