"""Pretrained Hugging Face ASL image + dynamic-sign video pipeline.

The image model handles static fingerspelling. The WLASL VideoMAE model handles
dynamic lexical signs. Both consume the same MediaPipe-tracked camera stream;
there is no user-selected mode and no project-specific label hardcoding.
"""

from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import dataclass
from contextlib import nullcontext
from threading import RLock
from typing import Any

import cv2
import numpy as np

from .model import FIXTURE_VOCABULARY, LandmarkExtractor, Prediction, VOCABULARY, canonical_gloss

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None  # type: ignore[assignment]

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[assignment]

try:
    from transformers import AutoImageProcessor, AutoModelForImageClassification, AutoModelForVideoClassification
except ImportError:  # pragma: no cover
    AutoImageProcessor = AutoModelForImageClassification = AutoModelForVideoClassification = None  # type: ignore[assignment]


DEFAULT_IMAGE_MODEL = "prithivMLmods/Alphabet-Sign-Language-Detection"
DEFAULT_VIDEO_MODEL = "Shawon16/VideoMAE_WLASL_2000_200_epochs_p20_SR_8_kinetics"
DEFAULT_VIDEO_FRAMES = 16
DEFAULT_VIDEO_INTERVAL_MS = 250


def _model_device() -> str:
    requested = os.environ.get("SIGN_MODEL_DEVICE", "cuda").lower()
    if requested == "cuda" and (torch is None or not torch.cuda.is_available()):
        return "cuda"
    return requested


def _label_map(model: Any) -> dict[int, str]:
    raw = getattr(getattr(model, "config", None), "id2label", {}) or {}
    return {int(index): str(label) for index, label in raw.items()}


def _normalise_video_label(label: str) -> str | None:
    value = " ".join(label.strip().lower().replace("_", " ").split())
    aliases = {
        "thank you": "THANK-YOU",
        "thank-you": "THANK-YOU",
        "thankyou": "THANK-YOU",
    }
    gloss = aliases.get(value, canonical_gloss(value))
    if gloss in set(VOCABULARY):
        return gloss
    return None


@dataclass(frozen=True)
class HFPrediction:
    prediction: Prediction
    hands_detected: int


class HuggingFaceDoublePipeline:
    """Lazy-loaded shared inference engines for one process."""

    def __init__(self, weights_dir: str | os.PathLike[str] | None = None) -> None:
        _ = weights_dir
        self.device = _model_device()
        self.require_cuda = os.environ.get("SIGN_REQUIRE_CUDA", "1") == "1"
        self.use_amp = self.device.startswith("cuda")
        self.image_model_id = os.environ.get("SIGN_IMAGE_MODEL_ID", DEFAULT_IMAGE_MODEL)
        self.video_model_id = os.environ.get("SIGN_VIDEO_MODEL_ID", DEFAULT_VIDEO_MODEL)
        self.image_revision = os.environ.get("SIGN_IMAGE_MODEL_REVISION")
        self.video_revision = os.environ.get("SIGN_VIDEO_MODEL_REVISION")
        self.video_frames = int(os.environ.get("SIGN_VIDEO_NUM_FRAMES", str(DEFAULT_VIDEO_FRAMES)))
        self.video_interval_ms = int(os.environ.get("SIGN_VIDEO_INFERENCE_INTERVAL_MS", str(DEFAULT_VIDEO_INTERVAL_MS)))
        self.image_processor: Any = None
        self.image_model: Any = None
        self.video_processor: Any = None
        self.video_model: Any = None
        self.image_labels: dict[int, str] = {}
        self.video_labels: dict[int, str] = {}
        self.loaded = False
        self.load_error: str | None = None
        self.last_video_at = 0
        self.last_video_prediction: Prediction | None = None
        self.frames: deque[np.ndarray] = deque(maxlen=max(16, self.video_frames))
        self.wrist_history: deque[np.ndarray] = deque(maxlen=8)
        self._inference_lock = RLock()
        self.last_diagnostics: dict[str, Any] = {
            "device": self.device,
            "image_loaded": False,
            "video_loaded": False,
            "image_ms": None,
            "video_ms": None,
            "alphabet_top": None,
            "dynamic_top": None,
        }
        self.extractor = LandmarkExtractor()

    @property
    def model_name(self) -> str:
        return "hf-asl-alphabet-wlasl-v1"

    @property
    def vocabulary(self) -> list[str]:
        # The service advertises the contract vocabulary, while the runtime
        # filters dynamic model labels to it and generates arbitrary spellings.
        return list(dict.fromkeys([*FIXTURE_VOCABULARY, *list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")]))

    def ensure_loaded(self) -> None:
        if self.loaded or self.load_error:
            return
        if torch is None or Image is None or AutoImageProcessor is None:
            self.load_error = "install torch, pillow, and transformers to enable Hugging Face inference"
            return
        if self.require_cuda and (not self.device.startswith("cuda") or not torch.cuda.is_available()):
            self.load_error = "CUDA is required but this Python environment has no CUDA-enabled PyTorch"
            return
        if self.device.startswith("cuda") and not torch.cuda.is_available():
            self.load_error = "SIGN_MODEL_DEVICE=cuda but torch.cuda.is_available() is false"
            return
        try:
            image_kwargs = {"revision": self.image_revision} if self.image_revision else {}
            video_kwargs = {"revision": self.video_revision} if self.video_revision else {}
            self.image_processor = AutoImageProcessor.from_pretrained(self.image_model_id, **image_kwargs)
            self.image_model = AutoModelForImageClassification.from_pretrained(self.image_model_id, **image_kwargs)
            self.image_model.to(self.device).eval()
            self.image_labels = _label_map(self.image_model)
            self.last_diagnostics["image_loaded"] = True
            self.video_processor = AutoImageProcessor.from_pretrained(self.video_model_id, **video_kwargs)
            self.video_model = AutoModelForVideoClassification.from_pretrained(self.video_model_id, **video_kwargs)
            self.video_model.to(self.device).eval()
            self.video_labels = _label_map(self.video_model)
            self.last_diagnostics["video_loaded"] = True
            self.loaded = True
            if self.device.startswith("cuda"):
                torch.cuda.reset_peak_memory_stats()
            print(
                f"[sign-model] device={self.device} amp={self.use_amp} "
                f"image_labels={len(self.image_labels)} video_labels={len(self.video_labels)}",
                flush=True,
            )
        except Exception as exc:  # keep the socket alive and report a clean error
            self.load_error = f"could not load Hugging Face models: {exc}"

    def close(self) -> None:
        self.extractor.close()
        self.image_model = None
        self.video_model = None
        self.loaded = False

    def reset(self) -> None:
        self.frames.clear()
        self.wrist_history.clear()
        self.last_video_at = 0
        self.last_video_prediction = None

    @staticmethod
    def _crop_hand(image: np.ndarray, raw_hands: list[np.ndarray]) -> np.ndarray:
        if not raw_hands:
            return image
        height, width = image.shape[:2]
        # Alphabet checkpoints are trained on one isolated hand. If two hands
        # are visible, use the largest visible hand instead of merging them.
        points = max(
            raw_hands,
            key=lambda hand: float(np.ptp(hand[:, 0]) * np.ptp(hand[:, 1])),
        )
        x_min, y_min = np.min(points[:, :2], axis=0)
        x_max, y_max = np.max(points[:, :2], axis=0)
        margin_x = max((x_max - x_min) * 0.35, 0.06)
        margin_y = max((y_max - y_min) * 0.35, 0.06)
        left = max(0, int((x_min - margin_x) * width))
        top = max(0, int((y_min - margin_y) * height))
        right = min(width, int((x_max + margin_x) * width))
        bottom = min(height, int((y_max + margin_y) * height))
        crop = image[top:bottom, left:right]
        return crop if crop.size else image

    def _autocast(self):
        if self.use_amp and torch is not None:
            return torch.autocast(device_type="cuda", dtype=torch.float16)
        return nullcontext()

    def _predict_letter(self, crop: np.ndarray) -> Prediction | None:
        if self.image_model is None or self.image_processor is None:
            return None
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(rgb)
        inputs = self.image_processor(images=image, return_tensors="pt")
        inputs = {key: value.to(self.device) if hasattr(value, "to") else value for key, value in inputs.items()}
        started = time.perf_counter()
        with torch.inference_mode(), self._autocast():
            logits = self.image_model(**inputs).logits[0]
            probabilities = torch.softmax(logits, dim=0)
            confidence, index = torch.max(probabilities, dim=0)
        label = self.image_labels.get(int(index), "")
        self.last_diagnostics["image_ms"] = round((time.perf_counter() - started) * 1000, 1)
        self.last_diagnostics["alphabet_top"] = (label, round(float(confidence), 3))
        if len(label.strip()) != 1 or not label.strip().isalpha():
            return None
        return Prediction(label.strip().upper(), float(confidence), "FINGERSPELL", "hf-alphabet")

    def _predict_video(self) -> Prediction | None:
        if len(self.frames) < self.video_frames or self.video_model is None or self.video_processor is None:
            return self.last_video_prediction
        now = int(time.time() * 1000)
        if now - self.last_video_at < self.video_interval_ms:
            return self.last_video_prediction
        self.last_video_at = now
        indices = np.linspace(0, len(self.frames) - 1, self.video_frames).round().astype(int)
        frames = [self.frames[int(index)] for index in indices]
        rgb_frames = [cv2.cvtColor(frame, cv2.COLOR_BGR2RGB) for frame in frames]
        inputs = self.video_processor(images=rgb_frames, return_tensors="pt")
        inputs = {key: value.to(self.device) if hasattr(value, "to") else value for key, value in inputs.items()}
        started = time.perf_counter()
        with torch.inference_mode(), self._autocast():
            logits = self.video_model(**inputs).logits[0]
            probabilities = torch.softmax(logits, dim=0)
            top_values, top_indices = torch.topk(probabilities, k=min(5, len(probabilities)))
        self.last_diagnostics["video_ms"] = round((time.perf_counter() - started) * 1000, 1)
        for value, index in zip(top_values, top_indices):
            label = _normalise_video_label(self.video_labels.get(int(index), ""))
            if label is not None:
                self.last_video_prediction = Prediction(label, float(value), "SIGN", "hf-wlasl")
                self.last_diagnostics["dynamic_top"] = (label, round(float(value), 3))
                return self.last_video_prediction
        self.last_video_prediction = None
        return None

    def process(self, jpeg: bytes) -> tuple[np.ndarray, int, Prediction | None]:
        encoded = np.frombuffer(jpeg, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("image is not a valid JPEG")
        landmarks, hands = self.extractor.extract(image)
        self.frames.append(image.copy())
        if not hands:
            self.reset()
            return landmarks, 0, None
        self.ensure_loaded()
        if not self.loaded:
            return landmarks, hands, None
        if self.extractor.last_raw_hands:
            self.wrist_history.append(self.extractor.last_raw_hands[0][0].copy())
        crop = self._crop_hand(image, self.extractor.last_raw_hands)
        motion = 0.0
        if len(self.wrist_history) >= 2:
            motion = float(np.mean(np.linalg.norm(np.diff(np.asarray(self.wrist_history)[:, :2], axis=0), axis=1)))
        letter = self._predict_letter(crop)
        dynamic = self._predict_video()
        # Both pretrained models run continuously. Motion decides which model
        # is appropriate for the current sign without a user-selected mode.
        if motion < 0.025 and letter is not None and letter.confidence >= 0.55:
            return landmarks, hands, letter
        if dynamic is not None and dynamic.confidence >= 0.20:
            return landmarks, hands, dynamic
        return landmarks, hands, letter or dynamic


_SHARED_PIPELINE: HuggingFaceDoublePipeline | None = None


def shared_pipeline() -> HuggingFaceDoublePipeline:
    global _SHARED_PIPELINE
    if _SHARED_PIPELINE is None:
        _SHARED_PIPELINE = HuggingFaceDoublePipeline()
    return _SHARED_PIPELINE
