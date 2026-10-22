"""Continuous RNNoise enhancement with source-aligned, duration-preserving output."""

import ctypes
from collections.abc import Callable
from typing import Protocol

import numpy as np
from scipy.signal import firwin, lfilter

from .stream_profile import AudioSpan


class NativeProcessor(Protocol):
    delay_samples: int  # At 48 kHz.

    def process(self, frame: np.ndarray) -> np.ndarray: ...
    def close(self) -> None: ...


class RNNoiseNative:
    # RNNoise v0.2 has an analysis/synthesis hop plus a delayed spectral hop.
    delay_samples = 960

    def __init__(self):
        from pyrnnoise import rnnoise

        self.api = rnnoise
        if rnnoise.FRAME_SIZE != 480:
            raise RuntimeError("unsupported RNNoise frame size")
        self.state = rnnoise.create()
        if not self.state:
            raise RuntimeError("RNNoise allocation failed")

    def process(self, frame):
        # The C API uses float PCM in int16 units. Avoid wrapper int16 rounding/clipping.
        pcm = np.ascontiguousarray(frame * 32768, dtype=np.float32)
        pointer = pcm.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
        self.api.lib.rnnoise_process_frame(self.state, pointer, pointer)
        return pcm / 32768

    def close(self):
        if self.state:
            self.api.destroy(self.state)
            self.state = None


class NoiseSuppressor:
    name = "rnnoise-0.2/pyrnnoise-0.4.5"

    def __init__(self, native_factory: Callable[[], NativeProcessor] = RNNoiseNative):
        self.factory = native_factory
        self.native = None
        self.closed = False
        self.kernel = firwin(61, 1 / 3, window=("kaiser", 5.0))
        self.reset()

    def reset(self):
        if self.closed:
            raise RuntimeError("noise suppression is closed")
        if self.native is not None:
            self.native.close()
        try:
            self.native = self.factory()
        except Exception as error:
            raise RuntimeError("local noise suppression is unavailable") from error
        if self.native.delay_samples % 3:
            raise RuntimeError("noise suppression delay is not sample-aligned")
        # Each 61-tap FIR contributes 30 samples at 48 kHz.
        self.delay_samples = (60 + self.native.delay_samples) // 3
        self.trim = self.delay_samples
        self.up_state = np.zeros(60)
        self.down_state = np.zeros(60)
        self.phase = 0
        self.pending = np.empty(0, np.float64)
        self.start = None
        self.accepted = 0
        self.emitted = 0
        self.finished = False

    def process(self, span: AudioSpan) -> list[AudioSpan]:
        if self.closed or self.finished:
            raise RuntimeError("noise suppression stream has ended")
        pcm = np.asarray(span.pcm)
        if pcm.ndim != 1 or not pcm.size or not np.isfinite(pcm).all():
            raise ValueError("invalid noise suppression PCM")
        if self.start is None:
            self.start = span.start_sample
        if span.start_sample != self.start + self.accepted:
            raise ValueError("noise suppression source discontinuity")
        self.accepted += pcm.size
        return self._convert(pcm)

    def _convert(self, pcm):
        up = np.zeros(pcm.size * 3)
        up[::3] = pcm
        up, self.up_state = lfilter(self.kernel * 3, [1], up, zi=self.up_state)
        self.pending = np.concatenate((self.pending, up))
        outputs = []
        consumed = 0
        while self.pending.size - consumed >= 480:
            frame = self.pending[consumed : consumed + 480]
            try:
                enhanced = np.asarray(self.native.process(frame), dtype=np.float64)
            except Exception as error:
                raise RuntimeError("local noise suppression failed") from error
            if enhanced.shape != (480,) or not np.isfinite(enhanced).all():
                raise RuntimeError("noise suppression produced invalid PCM")
            down, self.down_state = lfilter(self.kernel, [1], enhanced, zi=self.down_state)
            offset = (-self.phase) % 3
            outputs.append(down[offset::3])
            self.phase = (self.phase + 480) % 3
            consumed += 480
        self.pending = self.pending[consumed:]
        if not outputs:
            return []
        output = np.concatenate(outputs)
        skip = min(self.trim, output.size)
        output = output[skip:]
        self.trim -= skip
        output = output[: self.accepted - self.emitted]
        if not output.size:
            return []
        # Continuous memoryless soft knee: unity below 0.8, smooth saturation above.
        magnitude = np.abs(output)
        excess = np.maximum(magnitude - 0.8, 0)
        limited = np.minimum(magnitude, 0.8) + 0.179999 * np.tanh(excess / 0.179999)
        output = (np.sign(output) * limited).astype(np.float32)
        span = AudioSpan(self.start + self.emitted, output)
        self.emitted += output.size
        return [span]

    def flush(self) -> list[AudioSpan]:
        if self.closed or self.finished:
            return []
        outputs = []
        while self.emitted < self.accepted:
            outputs.extend(self._convert(np.zeros(self.delay_samples + 160)))
        self.finished = True
        return outputs

    def close(self):
        if self.native is not None:
            self.native.close()
            self.native = None
        self.closed = True


class PassthroughSuppressor:
    """Enhancement explicitly disabled: separated audio is emitted unchanged with no added delay.

    Used where the native RNNoise wheel is unavailable (e.g. macOS < 26) or with `--noise off`.
    The active processor name is reported in /health and the live `ready` message.
    """

    name = "off"
    delay_samples = 0

    def __init__(self):
        self.closed = False
        self.reset()

    def reset(self):
        if self.closed:
            raise RuntimeError("noise suppression is closed")
        self.start = None
        self.accepted = 0
        self.finished = False

    def process(self, span: AudioSpan) -> list[AudioSpan]:
        if self.closed or self.finished:
            raise RuntimeError("noise suppression stream has ended")
        pcm = np.asarray(span.pcm)
        if pcm.ndim != 1 or not pcm.size or not np.isfinite(pcm).all():
            raise ValueError("invalid noise suppression PCM")
        if self.start is None:
            self.start = span.start_sample
        if span.start_sample != self.start + self.accepted:
            raise ValueError("noise suppression source discontinuity")
        self.accepted += pcm.size
        return [AudioSpan(span.start_sample, pcm.astype(np.float32))]

    def flush(self) -> list[AudioSpan]:
        self.finished = True
        return []

    def close(self):
        self.closed = True


NOISE_MODES = ("auto", "rnnoise", "off")


def rnnoise_available() -> bool:
    try:
        from pyrnnoise import rnnoise  # noqa: F401
    except Exception:
        return False
    return True


def noise_factory(mode: str = "auto"):
    """`auto` uses RNNoise when its native wheel is installed, else the explicit passthrough."""
    if mode not in NOISE_MODES:
        raise ValueError("Unsupported noise mode")
    if mode == "off" or (mode == "auto" and not rnnoise_available()):
        return PassthroughSuppressor
    return NoiseSuppressor
