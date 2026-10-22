"""Streaming decoder for the two pretrained Hugging Face sign models."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from threading import RLock

from .hf_pipeline import HuggingFaceDoublePipeline, shared_pipeline
from .model import Prediction, VOCABULARY


@dataclass(frozen=True)
class FrameResult:
    hands_detected: int
    partial: Prediction | None = None


class Recognizer:
    """Use the pretrained alphabet and WLASL video models continuously.

    The recognizer does not select a user-facing "letter mode" or "word mode".
    Both models receive the same live frames. The websocket layer can assemble
    consecutive letter tokens into a spelling word without knowing any special
    acronym vocabulary.
    """

    def __init__(self, weights_dir: str | Path | None = None) -> None:
        _ = weights_dir
        self.pipeline: HuggingFaceDoublePipeline = shared_pipeline()
        self.predictions: deque[Prediction] = deque(maxlen=8)
        self._lock = RLock()
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self.predictions.clear()
            self.pipeline.reset()

    def close(self) -> None:
        # The shared pipeline belongs to the process, not a single socket.
        pass

    @property
    def vocabulary(self) -> list[str]:
        return self.pipeline.vocabulary

    @property
    def model_name(self) -> str:
        return self.pipeline.model_name

    @property
    def load_error(self) -> str | None:
        return self.pipeline.load_error

    @property
    def diagnostics(self) -> dict:
        return dict(self.pipeline.last_diagnostics)

    def process(self, jpeg: bytes, ts: int) -> FrameResult:
        _ = ts
        with self._lock:
            landmarks, hands_detected, prediction = self.pipeline.process(jpeg)
            _ = landmarks
            if self.pipeline.loaded and self.pipeline.last_diagnostics.get("image_ms") is not None:
                print_diagnostics = False
                # Keep terminal output useful during live testing without
                # flooding it at camera FPS.
                import time

                now = time.monotonic()
                if now - getattr(self, "_last_diag_at", 0.0) >= 0.5:
                    self._last_diag_at = now
                    print_diagnostics = True
                if print_diagnostics:
                    print(f"[sign-model] {self.pipeline.last_diagnostics}", flush=True)
            if hands_detected == 0:
                self.predictions.clear()
                return FrameResult(0, None)
            if prediction is None:
                self.predictions.clear()
                return FrameResult(hands_detected, None)
            self.predictions.append(prediction)
            return FrameResult(hands_detected, self._stable_prediction())

    def _stable_prediction(self) -> Prediction | None:
        if not self.predictions:
            return None
        grouped: dict[tuple[str, str, str], list[Prediction]] = {}
        for prediction in self.predictions:
            grouped.setdefault((prediction.gloss, prediction.kind, prediction.source), []).append(prediction)
        winner = max(
            grouped.values(),
            key=lambda values: (len(values), sum(item.confidence for item in values) / len(values)),
        )
        latest = winner[-1]
        confidence = sum(item.confidence for item in winner) / len(winner)
        return Prediction(latest.gloss, confidence, latest.kind, latest.source)


class ScriptedRecognizer:
    """Deterministic recognizer used only by the protocol test."""

    vocabulary = VOCABULARY
    model_name = "test"
    load_error = None

    def __init__(self, *_args, **_kwargs) -> None:
        self.frame = 0

    def reset(self) -> None:
        self.frame = 0

    def close(self) -> None:
        pass

    def process(self, jpeg: bytes, ts: int) -> FrameResult:
        _ = jpeg, ts
        self.frame += 1
        if self.frame <= 2:
            return FrameResult(1, Prediction("PLEASE", 0.65, "SIGN", "test"))
        if self.frame <= 6:
            return FrameResult(1, Prediction("PLEASE", 0.84, "SIGN", "test"))
        return FrameResult(0, None)
