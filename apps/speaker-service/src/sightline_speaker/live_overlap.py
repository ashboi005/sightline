"""Weighted streaming assembly without dropping or repeating source samples."""

import numpy as np

from .stream_profile import AudioSpan, StreamProfile


class LiveOverlap:
    def __init__(self, profile: StreamProfile):
        self.profile = profile
        self.weights = np.hanning(profile.window_samples + 2)[1:-1].astype(np.float64)
        self.reset()

    def reset(self):
        self.cursor: int | None = None
        self.next_start: int | None = None
        self.values = np.empty(0, dtype=np.float64)
        self.sums = np.empty(0, dtype=np.float64)
        self.finished = False

    def _emit(self, count: int) -> list[AudioSpan]:
        if count <= 0:
            return []
        if self.cursor is None or np.any(self.sums[:count] <= 0):
            raise ValueError("Missing weighted source samples")
        output = (self.values[:count] / self.sums[:count]).astype(np.float32)
        span = AudioSpan(self.cursor, output)
        self.cursor += count
        self.values = self.values[count:].copy()
        self.sums = self.sums[count:].copy()
        return [span]

    def push(self, start_sample: int, pcm: np.ndarray, source_end_sample=None) -> list[AudioSpan]:
        if pcm.shape != (self.profile.window_samples,) or not np.isfinite(pcm).all():
            raise ValueError("Model output must have the expected shape and finite samples")
        if self.finished or (self.next_start is not None and start_sample != self.next_start):
            raise ValueError("Model windows must be contiguous")
        if self.cursor is None:
            self.cursor = start_sample
        width = self.profile.window_samples
        padding = width - self.values.size
        self.values = np.pad(self.values, (0, padding))
        self.sums = np.pad(self.sums, (0, padding))
        self.values += pcm.astype(np.float64) * self.weights
        self.sums += self.weights
        self.next_start = start_sample + self.profile.stride_samples
        count = self.profile.stride_samples
        if source_end_sample is not None:
            if source_end_sample < self.cursor:
                raise ValueError("Source end precedes emitted samples")
            count = min(count, source_end_sample - self.cursor)
        return self._emit(count)

    def flush(self, source_end_sample: int) -> list[AudioSpan]:
        if self.finished:
            return []
        self.finished = True
        if self.cursor is None:
            return []
        count = source_end_sample - self.cursor
        if count < 0 or count > self.values.size:
            raise ValueError("Final source interval is not covered by model output")
        result = self._emit(count)
        self.values = np.empty(0, dtype=np.float64)
        self.sums = np.empty(0, dtype=np.float64)
        return result
