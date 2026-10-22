"""Bounded, cancellable extraction with normalized overlap-add."""

from collections.abc import Callable
from dataclasses import dataclass
from time import perf_counter

import numpy as np

from .faces import FaceTrack, prepare_frames
from .media import DecodedMedia
from .model import SAMPLE_RATE, TargetSeparator


class ExtractionCancelled(Exception):
    """The owner cancelled this generation; no result may be published."""


@dataclass
class AudioWindow:
    start: int
    audio: np.ndarray


@dataclass
class ExtractionResult:
    audio: np.ndarray
    elapsed_seconds: float
    window_seconds: list[float]
    window_duration: float
    stride: float
    gain: float


def assemble_windows(windows: list[AudioWindow], sample_count: int) -> np.ndarray:
    if sample_count <= 0:
        raise ValueError("Output must contain samples")
    output = np.zeros(sample_count, dtype=np.float64)
    weights = np.zeros(sample_count, dtype=np.float64)
    for window in windows:
        if window.start < 0 or window.audio.ndim != 1 or not np.isfinite(window.audio).all():
            raise ValueError("Window audio must be finite mono PCM")
        size = min(window.audio.size, sample_count - window.start)
        if size <= 0:
            continue
        # Positive endpoints keep exact coverage at the first and last samples.
        weight = np.hanning(window.audio.size + 2)[1:-1][:size]
        output[window.start : window.start + size] += window.audio[:size] * weight
        weights[window.start : window.start + size] += weight
    if np.any(weights <= 0):
        raise ValueError("Incomplete audio coverage; extraction cannot be published")
    return (output / weights).astype(np.float32)


def extract_track(
    media: DecodedMedia,
    track: FaceTrack,
    separator: TargetSeparator,
    cancel: Callable[[], bool],
    progress: Callable[[float], None],
    window_duration: float | None = None,
    stride: float | None = None,
) -> ExtractionResult:
    window_duration = (
        getattr(separator, "clip_window_duration", 2.0)
        if window_duration is None
        else window_duration
    )
    stride = getattr(separator, "clip_stride", 1.0) if stride is None else stride
    if not 0.1 <= stride <= window_duration <= 8:
        raise ValueError("Invalid extraction window or stride")
    size = round(window_duration * SAMPLE_RATE)
    step = round(stride * SAMPLE_RATE)
    starts = range(0, media.audio.size, step)
    if not len(starts):
        raise ValueError("Clip contains no audio")
    windows, timings = [], []
    begin = perf_counter()
    for index, start in enumerate(starts):
        if cancel():
            raise ExtractionCancelled()
        tick = perf_counter()
        pcm = np.zeros(size, dtype=np.float32)
        available = media.audio[start : start + size]
        pcm[: available.size] = available
        frames = prepare_frames(
            media,
            track,
            start / SAMPLE_RATE,
            window_duration,
            getattr(separator, "engine_key", "rtfs"),
        )
        focused = separator.extract(pcm, frames)
        if cancel():
            raise ExtractionCancelled()
        if focused.shape != pcm.shape or not np.isfinite(focused).all():
            raise ValueError("Model output must be finite and match the input length")
        windows.append(AudioWindow(start, focused))
        timings.append(perf_counter() - tick)
        progress((index + 1) / len(starts))
    output = assemble_windows(windows, media.audio.size)
    peak = float(np.max(np.abs(output)))
    gain = min(1.0, 0.98 / peak) if peak > 0 else 1.0
    output *= gain
    return ExtractionResult(output, perf_counter() - begin, timings, window_duration, stride, gain)
