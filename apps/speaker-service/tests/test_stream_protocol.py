import importlib
import struct

import numpy as np
import pytest


def module():
    try:
        return importlib.import_module("sightline_speaker.stream_protocol")
    except ImportError:
        pytest.fail("Versioned source-sample streaming is not implemented")


def profile():
    return importlib.import_module("sightline_speaker.stream_profile").profile_for("av-mossformer2")


def test_packet_has_exact_independent_sample_and_capture_clocks():
    protocol = module()
    pcm = np.zeros(1600, dtype="<f4").tobytes()
    encoded = protocol.encode_packet(1, 3, 1600, 10.0, pcm)
    assert encoded[:32] == struct.pack("<4sB3xIQdI", b"GSP2", 1, 3, 1600, 10.0, 6400)
    packet = protocol.decode_packet(encoded)
    assert (packet.sample_start, packet.capture_time, packet.generation) == (1600, 10.0, 3)


@pytest.mark.parametrize(
    "bad",
    [
        struct.pack("<4sB3xIQdI", b"GSP1", 1, 0, 0, 1.0, 4) + bytes(4),
        struct.pack("<4sB3xIQdI", b"GSP2", 1, 0, 2**53, 1.0, 4) + bytes(4),
        struct.pack("<4sB3xIQdI", b"GSP2", 1, 0, 0, float("nan"), 4) + bytes(4),
        struct.pack("<4sB3xIQdI", b"GSP2", 1, 0, 0, 1.0, 4) + struct.pack("<f", float("inf")),
    ],
)
def test_invalid_packet_does_not_reach_source_buffer(bad):
    with pytest.raises(ValueError):
        module().decode_packet(bad)


def populated_buffer(sample_count):
    buffer = module().LiveBuffer(profile())
    image = np.zeros((8, 8, 3), dtype=np.uint8)
    for sample in range(0, sample_count, 1600):
        buffer.frame(sample, image)
        length = min(1600, sample_count - sample)
        buffer.audio(sample, 10 + sample / 16000, np.ones(length, dtype=np.float32) * 0.2)
    return buffer


def test_profile_window_and_final_padding_preserve_source_samples():
    buffer = populated_buffer(50000)
    first = buffer.window()
    assert first.audio.size == 48000
    assert first.start_sample == 0
    assert buffer.sample_count == 21200
    tail = buffer.window(final=True)
    assert tail.start_sample == 28800
    assert tail.valid_samples == 21200
    assert np.all(tail.audio[21200:] == 0)
    assert buffer.window(final=True) is None


def test_replay_pause_changes_capture_time_without_source_discontinuity():
    buffer = module().LiveBuffer(profile())
    buffer.audio(0, 10.0, np.zeros(1600, dtype=np.float32))
    buffer.audio(1600, 30.0, np.zeros(1600, dtype=np.float32))
    with pytest.raises(ValueError, match="sample"):
        buffer.audio(4000, 30.1, np.zeros(1600, dtype=np.float32))


def test_source_memory_limit_does_not_silently_discard_audio():
    buffer = module().LiveBuffer(profile(), max_pcm_bytes=6400)
    buffer.audio(0, 10, np.zeros(1600, dtype=np.float32))
    with pytest.raises(ValueError, match="capacity"):
        buffer.audio(1600, 10.1, np.zeros(1600, dtype=np.float32))
    assert buffer.sample_count == 1600


def test_internal_video_gap_remains_an_alignment_failure():
    buffer = populated_buffer(48000)
    buffer.frames = type(buffer.frames)([buffer.frames[0], buffer.frames[-1]])
    with pytest.raises(ValueError, match="gap"):
        buffer.window()
