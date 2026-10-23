"""Dependency-free recognition values shared by runtime and decoding."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np


@dataclass(frozen=True)
class Prediction:
    gloss: str
    confidence: float
    kind: str
    source: str = "alphabet-model"


@dataclass(frozen=True)
class RecognitionEvidence:
    prediction: Prediction | None
    observation: int


@dataclass(frozen=True)
class LandmarkInput:
    features: np.ndarray
    frame_id: int
    ts: int
    steady: bool = True


def continuity_gap_ms(fps: int) -> int:
    """Allow a missed frame at the negotiated cadence, with a 350 ms floor."""
    return max(350, round(2000 / fps))
