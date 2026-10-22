"""Sample-exact streaming profiles and source-clock metadata."""

from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16000
MAX_SAMPLE_INDEX = 2**53 - 1


@dataclass(frozen=True)
class StreamProfile:
    window_samples: int
    stride_samples: int

    def __post_init__(self):
        if not 0 < self.stride_samples < self.window_samples <= SAMPLE_RATE * 8:
            raise ValueError("Invalid streaming context/stride")
        if self.window_samples % 640:
            raise ValueError("Streaming context must align with the 25 fps visual model")

    @property
    def duration(self) -> float:
        return self.window_samples / SAMPLE_RATE


def profile_for(engine_key: str) -> StreamProfile:
    if engine_key == "av-mossformer2":
        return StreamProfile(48000, 28800)
    if engine_key == "rtfs":
        return StreamProfile(32000, 16000)
    raise ValueError("Unsupported streaming engine")


@dataclass(frozen=True)
class AudioSpan:
    start_sample: int
    pcm: np.ndarray


@dataclass(frozen=True)
class CaptureSpan:
    start_sample: int
    end_sample: int
    capture_time: float


def capture_spans_between(spans, start: int, end: int) -> list[CaptureSpan]:
    result = []
    cursor = start
    for span in spans:
        left, right = max(start, span.start_sample), min(end, span.end_sample)
        if left >= right:
            continue
        if left != cursor:
            raise ValueError("Missing source capture-clock mapping")
        result.append(
            CaptureSpan(left, right, span.capture_time + (left - span.start_sample) / SAMPLE_RATE)
        )
        cursor = right
    if cursor != end:
        raise ValueError("Missing source capture-clock mapping")
    return result
