"""Blend a short unpublished boundary without delaying for another analysis window."""

import numpy as np

from .stream_profile import AudioSpan


class AvailableOverlap:
    def __init__(self, blend_samples=160):
        self.blend_samples = blend_samples
        self.reset()

    def reset(self):
        self.tail = None
        self.next_sample = None
        self.finished = False

    def push(self, window_start, pcm, emit_start, count):
        if self.finished or (self.next_sample is not None and emit_start != self.next_sample):
            raise ValueError("Available audio intervals must be contiguous")
        offset = emit_start - window_start
        fresh = pcm[offset : offset + count].copy()
        if offset < 0 or fresh.size != count or not np.isfinite(fresh).all():
            raise ValueError("Available output interval is invalid")
        start = emit_start
        if self.tail is not None:
            first = self.tail.start_sample - window_start
            repeated = pcm[first : first + self.tail.pcm.size]
            if first < 0 or repeated.size != self.tail.pcm.size:
                repeated = self.tail.pcm
            ramp = np.linspace(0, 1, self.tail.pcm.size, dtype=np.float32)
            boundary = self.tail.pcm * (1 - ramp) + repeated * ramp
            fresh = np.concatenate((boundary, fresh))
            start = self.tail.start_sample
        self.next_sample = emit_start + count
        held = min(self.blend_samples, fresh.size)
        emitted = fresh.size - held
        self.tail = AudioSpan(start + emitted, fresh[emitted:])
        return [AudioSpan(start, fresh[:emitted])] if emitted else []

    def flush(self, end):
        if self.finished:
            return []
        if self.next_sample is not None and end != self.next_sample:
            raise ValueError("Final available output interval is incomplete")
        self.finished = True
        result = [self.tail] if self.tail is not None else []
        self.tail = None
        return result
