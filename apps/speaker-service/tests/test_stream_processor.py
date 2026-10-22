from types import SimpleNamespace

import numpy as np
import pytest
from test_noise import IdentityNative

from sightline_speaker.noise import NoiseSuppressor
from sightline_speaker.stream_processor import StreamProcessor
from sightline_speaker.stream_profile import CaptureSpan, StreamProfile
from sightline_speaker.stream_protocol import LiveWindow


def make_processor(monkeypatch):
    monkeypatch.setattr(
        "sightline_speaker.stream_processor.prepare_frames",
        lambda *_: np.zeros((50, 88, 88), np.float32),
    )
    separator = SimpleNamespace(engine_key="rtfs", device="cpu", extract=lambda audio, _: audio)
    processor = StreamProcessor(
        separator,
        StreamProfile(32000, 16000),
        noise_factory=lambda: NoiseSuppressor(native_factory=IdentityNative),
    )
    return processor, separator


def window(start, valid=32000, capture=1):
    frames = [np.zeros((8, 8, 3), np.uint8)]
    return LiveWindow(
        start,
        np.ones(32000, np.float32) * 0.2,
        frames,
        np.array([start / 16000]),
        [CaptureSpan(start, start + valid, capture)],
        valid,
    )


def test_processor_drains_exact_tail_and_preserves_capture_pauses(monkeypatch):
    processor, _ = make_processor(monkeypatch)
    processor.reset(1)
    output = processor.process(window(0), None, 1)
    output += processor.process(window(16000, 23017, 7), None, 1)
    output += processor.finish(39017)
    assert sum(item.span.pcm.size for item in output) == 39017
    assert output[0].span.start_sample == 0
    assert processor.finish(39017) == []
    for item in output:
        assert sum(s.end_sample - s.start_sample for s in item.captures) == item.span.pcm.size
    assert any(s.capture_time >= 8 for item in output for s in item.captures)
    processor.close()


def test_enhancement_failure_never_returns_original(monkeypatch):
    processor, separator = make_processor(monkeypatch)
    processor.reset(1)
    separator.extract = lambda *_: np.full(32000, np.nan, np.float32)
    with pytest.raises(ValueError):
        processor.process(window(0), None, 1)
    processor.close()


def test_generation_requires_reset(monkeypatch):
    processor, _ = make_processor(monkeypatch)
    processor.reset(1)
    with pytest.raises(ValueError, match="generation"):
        processor.process(window(0), None, 2)
    processor.close()
