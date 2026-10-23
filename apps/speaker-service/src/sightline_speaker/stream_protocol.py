"""Version-two packets: source sample position is separate from capture time."""

import struct
from collections import deque
from dataclasses import dataclass

import numpy as np

from .stream_profile import (
    MAX_SAMPLE_INDEX,
    SAMPLE_RATE,
    CaptureSpan,
    StreamProfile,
    capture_spans_between,
)

HEADER = struct.Struct("<4sB3xIQdI")


@dataclass(frozen=True)
class Packet:
    kind: int
    generation: int
    sample_start: int
    capture_time: float
    payload: bytes


def encode_packet(kind, generation, sample_start, capture_time, payload) -> bytes:
    data = (
        HEADER.pack(b"GSP2", kind, generation, sample_start, capture_time, len(payload)) + payload
    )
    decode_packet(data)
    return data


def decode_packet(data: bytes) -> Packet:
    if len(data) < HEADER.size or len(data) > 220000:
        raise ValueError("Malformed streaming packet size")
    magic, kind, generation, sample, captured, size = HEADER.unpack_from(data)
    if magic != b"GSP2":
        raise ValueError("Streaming protocol version mismatch; reload the matching frontend")
    if (
        kind not in {1, 2}
        or sample > MAX_SAMPLE_INDEX
        or not np.isfinite(captured)
        or captured < 0
        or size != len(data) - HEADER.size
        or not size
    ):
        raise ValueError("Malformed streaming packet header")
    payload = data[HEADER.size :]
    if kind == 1:
        if size % 4 or size > 12800:
            raise ValueError("PCM packets must contain at most 200 ms of float32 audio")
        pcm = np.frombuffer(payload, dtype="<f4")
        if not np.isfinite(pcm).all() or np.max(np.abs(pcm)) > 1.01:
            raise ValueError("PCM must contain finite normalized mono samples")
    return Packet(kind, generation, sample, captured, payload)


@dataclass(frozen=True)
class LiveWindow:
    start_sample: int
    audio: np.ndarray
    frames: list[np.ndarray]
    timestamps: np.ndarray
    captures: list[CaptureSpan]
    valid_samples: int
    emit_start_sample: int | None = None
    emit_samples: int | None = None

    @property
    def start(self):
        return self.start_sample / SAMPLE_RATE


class InputCapacityError(ValueError):
    """Valid input reached a memory bound; stop accepting and drain its existing samples."""


class LiveBuffer:
    def __init__(
        self,
        profile: StreamProfile,
        max_pcm_bytes=4 * 1024**2,
        max_frame_bytes=128 * 1024**2,
        video_lag_samples=0,
    ):
        if not 0 <= video_lag_samples <= 8000:
            raise ValueError("Video lag must stay within the supported 500 ms offset")
        self.profile = profile
        self.video_lag_samples = video_lag_samples
        self.max_pcm_bytes = max_pcm_bytes
        self.max_frame_bytes = max_frame_bytes
        self.reset()

    def reset(self):
        self.frames = deque()
        self.frame_bytes = 0
        self.pcm = np.empty(0, dtype=np.float32)
        self.start_sample: int | None = None
        self.next_audio: int | None = None
        self.captures = deque()

    @property
    def sample_count(self):
        return self.pcm.size

    def audio(self, sample_start: int, capture_time: float, pcm: np.ndarray):
        if self.next_audio is not None and sample_start != self.next_audio:
            raise ValueError("Audio source sample discontinuity")
        if pcm.ndim != 1 or not pcm.size or not np.isfinite(pcm).all():
            raise ValueError("Invalid source audio")
        if self.pcm.nbytes + pcm.nbytes > self.max_pcm_bytes:
            raise InputCapacityError("Audio source capacity reached; processing cannot keep up")
        if self.start_sample is None:
            self.start_sample = sample_start
        self.next_audio = sample_start + pcm.size
        self.pcm = np.concatenate((self.pcm, pcm)).astype(np.float32)
        span = CaptureSpan(sample_start, self.next_audio, capture_time)
        if self.captures:
            previous = self.captures[-1]
            expected = (
                previous.capture_time + (previous.end_sample - previous.start_sample) / SAMPLE_RATE
            )
            if (
                previous.end_sample == sample_start
                and abs(capture_time - expected) < 1 / SAMPLE_RATE
            ):
                self.captures[-1] = CaptureSpan(
                    previous.start_sample, self.next_audio, previous.capture_time
                )
                return
        self.captures.append(span)

    def frame(self, sample_start: int, image: np.ndarray):
        if self.frames and sample_start <= self.frames[-1][0]:
            raise ValueError("Video source sample discontinuity")
        if self.frame_bytes + image.nbytes > self.max_frame_bytes:
            raise InputCapacityError("Video source capacity reached; processing cannot keep up")
        self.frames.append((sample_start, image))
        self.frame_bytes += image.nbytes

    def window(self, final=False) -> LiveWindow | None:
        width = self.profile.window_samples
        if self.start_sample is None or not self.pcm.size or (not final and self.pcm.size < width):
            return None
        valid = min(width, self.pcm.size)
        start = self.start_sample
        end = start + valid
        if not self.frames:
            raise ValueError("Missing video; check camera/microphone synchronization")
        samples = np.array([item[0] for item in self.frames], dtype=np.int64)
        if not final and samples[-1] < end - 2400:
            if self.next_audio and self.next_audio - samples[-1] > 4800 + self.video_lag_samples:
                raise ValueError(
                    "Audio/video gap exceeds the configured timing offset and grace period"
                )
            return None
        indices = np.flatnonzero((samples >= start - 2400) & (samples <= end + 2400))
        chosen = samples[indices]
        if (
            not chosen.size
            or abs(chosen[0] - start) > 2400
            or abs(chosen[-1] - end) > 2400
            or np.any(np.diff(chosen) > 2400)
        ):
            raise ValueError("Video gap/skew exceeds 150 ms")
        result = LiveWindow(
            start,
            np.pad(self.pcm[:valid], (0, width - valid)),
            [self.frames[int(index)][1] for index in indices],
            chosen.astype(np.float64) / SAMPLE_RATE,
            capture_spans_between(self.captures, start, end),
            valid,
        )
        consumed = min(self.profile.stride_samples, self.pcm.size)
        self.pcm = self.pcm[consumed:].copy()
        self.start_sample += consumed
        while self.captures and self.captures[0].end_sample <= self.start_sample:
            self.captures.popleft()
        while len(self.frames) > 1 and self.frames[1][0] <= self.start_sample - 2400:
            self.frame_bytes -= self.frames.popleft()[1].nbytes
        return result
