from types import SimpleNamespace

import numpy as np
import pytest
from test_noise import IdentityNative

from sightline_speaker.available_buffer import AvailableBuffer
from sightline_speaker.faces import FaceTrack
from sightline_speaker.noise import NoiseSuppressor
from sightline_speaker.stream_processor import StreamProcessor
from sightline_speaker.stream_profile import AudioSpan, StreamProfile


def feed(buffer, start, count, captured=10):
    for sample in range(start, start + count, 640):
        buffer.frame(sample, np.zeros((8, 8, 3), np.uint8))
    buffer.audio(start, captured, np.full(count, 0.2, np.float32))


def test_available_audio_is_released_before_a_full_analysis_context_accumulates():
    buffer = AvailableBuffer(history_samples=6400)
    feed(buffer, 0, 1920)
    chunk = buffer.window()
    assert chunk is not None
    assert chunk.start_sample == 0
    assert chunk.audio.size == 1920
    assert chunk.emit_start_sample == 0
    assert chunk.emit_samples == 1920
    assert buffer.sample_count == 0


def test_a_busy_worker_batches_new_samples_but_never_reemits_retained_history():
    buffer = AvailableBuffer(history_samples=6400)
    feed(buffer, 0, 1920)
    buffer.window()
    feed(buffer, 1920, 5120, 10.12)
    chunk = buffer.window()
    assert chunk is not None
    assert chunk.start_sample == 0
    assert chunk.valid_samples == 7040
    assert chunk.audio.size == 9600
    assert chunk.emit_start_sample == 1920
    assert chunk.emit_samples == 5120
    assert buffer.sample_count == 0
    feed(buffer, 7040, 3200, 10.44)
    chunk = buffer.window()
    assert chunk.start_sample == 640
    assert chunk.emit_start_sample == 7040
    assert chunk.emit_samples == 3200
    assert chunk.valid_samples == 9600
    assert chunk.audio.size == 9600


def test_available_processor_emits_contiguous_new_audio_and_drains_the_partial_tail(monkeypatch):
    monkeypatch.setattr(
        "sightline_speaker.stream_processor.prepare_frames",
        lambda media, track, start, duration, engine: np.zeros(
            (round(duration * 25), 88, 88), np.float32
        ),
    )
    separator = SimpleNamespace(engine_key="rtfs", extract=lambda audio, frames: audio)
    processor = StreamProcessor(
        separator,
        StreamProfile(32000, 16000),
        noise_factory=lambda: NoiseSuppressor(native_factory=IdentityNative),
    )
    processor.reset(1)
    buffer = AvailableBuffer(history_samples=6400)
    output = []
    try:
        for start, count in [(0, 1920), (1920, 5120), (7040, 1097)]:
            feed(buffer, start, count, 10 + start / 16000)
            chunk = buffer.window(final=count == 1097)
            output += processor.process(chunk, FaceTrack("selected"), 1)
        output += processor.finish(8137)
        pcm = np.concatenate([item.span.pcm for item in output])
        assert pcm.size == 8137
        baseline = NoiseSuppressor(native_factory=IdentityNative)
        try:
            spans = baseline.process(AudioSpan(0, np.full(8137, 0.2, np.float32)))
            spans += baseline.flush()
            np.testing.assert_allclose(
                pcm, np.concatenate([span.pcm for span in spans]), rtol=0, atol=3e-8
            )
        finally:
            baseline.close()
        cursor = 0
        for item in output:
            assert item.span.start_sample == cursor
            cursor += item.span.pcm.size
            assert (
                sum(span.end_sample - span.start_sample for span in item.captures)
                == item.span.pcm.size
            )
        assert processor.finish(8137) == []
    finally:
        processor.close()


def test_available_shapes_pad_without_waiting_for_future_samples():
    buffer = AvailableBuffer()
    feed(buffer, 0, 3840)
    window = buffer.window()
    assert window.emit_samples == 3840
    assert window.valid_samples == 3840
    assert window.audio.size == 6400
    assert np.all(window.audio[3840:] == 0)


@pytest.mark.parametrize("samples", [[0], [0, 8000, 15000]])
def test_final_audio_requires_actual_scene_coverage_even_when_inference_is_late(samples):
    buffer = AvailableBuffer()
    for sample in samples:
        buffer.frame(sample, np.zeros((8, 8, 3), np.uint8))
    buffer.audio(0, 10, np.zeros(16000, np.float32))
    with pytest.raises(ValueError, match="Scene frames"):
        buffer.window(final=True)
