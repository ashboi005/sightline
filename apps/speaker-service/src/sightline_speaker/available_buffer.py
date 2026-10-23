"""Batch only available input; retained history never postpones live output."""

import numpy as np

from .stream_profile import SAMPLE_RATE, StreamProfile, capture_spans_between, profile_for
from .stream_protocol import LiveBuffer, LiveWindow

MINIMUM_SAMPLES = 1920  # Three visual frames satisfy the model's minimum input.
FRAME_SAMPLES = 640
MAX_INPUT_SAMPLES = SAMPLE_RATE * 8  # Verified model shape/resource bound, not playout delay.
HISTORY_SAMPLES = 6400
INPUT_SHAPES = (MINIMUM_SAMPLES, *range(3200, MAX_INPUT_SAMPLES + 1, 3200))
WARM_INPUT_SHAPES = tuple(size for size in INPUT_SHAPES if size <= 32000)


def stream_parameters(engine: str) -> dict:
    """Use full AV context or the explicitly selected legacy RTFS input mode."""
    if engine == "av-mossformer2":
        profile = profile_for(engine)
        return dict(
            analysis_mode="windowed",
            minimum_samples=profile.window_samples,
            history_samples=profile.window_samples - profile.stride_samples,
            maximum_input_samples=profile.window_samples,
        )
    if engine != "rtfs":
        raise ValueError("Unsupported streaming engine")
    return dict(
        analysis_mode="available",
        minimum_samples=MINIMUM_SAMPLES,
        history_samples=HISTORY_SAMPLES,
        maximum_input_samples=MAX_INPUT_SAMPLES,
    )


class AvailableBuffer(LiveBuffer):
    def __init__(self, history_samples=HISTORY_SAMPLES):
        if not 0 <= history_samples <= MAX_INPUT_SAMPLES - MINIMUM_SAMPLES:
            raise ValueError("Invalid retained audio history")
        if history_samples % FRAME_SAMPLES:
            raise ValueError("Audio history must align with visual frames")
        self.history_samples = history_samples
        super().__init__(StreamProfile(MINIMUM_SAMPLES, FRAME_SAMPLES))

    def reset(self):
        super().reset()
        self.emit_cursor = None

    @property
    def sample_count(self):
        if self.emit_cursor is None or self.next_audio is None:
            return 0
        return self.next_audio - self.emit_cursor

    def audio(self, sample_start, capture_time, pcm):
        super().audio(sample_start, capture_time, pcm)
        if self.emit_cursor is None:
            self.emit_cursor = sample_start

    def window(self, final=False):
        if self.emit_cursor is None or not self.sample_count:
            return None
        start = self.start_sample
        end = min(self.next_audio, start + MAX_INPUT_SAMPLES)
        if not self.frames:
            if final:
                raise ValueError("Missing video; check camera/microphone synchronization")
            return None
        if not final:
            end = min(end, self.frames[-1][0] + FRAME_SAMPLES)
            end = self.emit_cursor + ((end - self.emit_cursor) // FRAME_SAMPLES) * FRAME_SAMPLES
            if end <= self.emit_cursor or end - start < MINIMUM_SAMPLES:
                return None
        valid = end - start
        width = next(size for size in INPUT_SHAPES if size >= valid)
        chosen = [(sample, image) for sample, image in self.frames if start - 2400 <= sample <= end]
        samples = np.array([sample for sample, _ in chosen])
        if (
            not samples.size
            or abs(samples[0] - start) > 2400
            or abs(samples[-1] - end) > 2400
            or np.any(np.diff(samples) > 2400)
        ):
            raise ValueError("Scene frames are missing for captured speech; check camera timing")
        window = LiveWindow(
            start,
            np.pad(self.pcm[:valid], (0, width - valid)),
            [image for _, image in chosen],
            np.array([sample / SAMPLE_RATE for sample, _ in chosen]),
            capture_spans_between(self.captures, start, end),
            valid,
            self.emit_cursor,
            end - self.emit_cursor,
        )
        self.emit_cursor = end
        retained = max(start, end - self.history_samples)
        self.pcm = self.pcm[retained - start :].copy()
        self.start_sample = retained
        while self.captures and self.captures[0].end_sample <= retained:
            self.captures.popleft()
        while len(self.frames) > 1 and self.frames[1][0] <= retained:
            self.frame_bytes -= self.frames.popleft()[1].nbytes
        return window
