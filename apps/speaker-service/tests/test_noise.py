import numpy as np
import pytest

from sightline_speaker.noise import NoiseSuppressor
from sightline_speaker.stream_profile import AudioSpan


class IdentityNative:
    delay_samples = 0

    def process(self, frame):
        return frame.copy()

    def close(self):
        pass


def suppress(chunks, start=917):
    noise = NoiseSuppressor(native_factory=IdentityNative)
    output = []
    cursor = start
    for chunk in chunks:
        output.extend(noise.process(AudioSpan(cursor, chunk)))
        cursor += chunk.size
    output.extend(noise.flush())
    assert noise.flush() == []
    noise.close()
    return output


def test_irregular_chunks_preserve_alignment_count_and_waveform():
    pcm = (0.2 * np.sin(np.arange(17031) * 0.13)).astype(np.float32)
    whole = suppress([pcm])
    split = suppress(np.split(pcm, [1, 31, 170, 523, 9001, 17000]))
    assert split[0].start_sample == 917
    cursor = 917
    for span in split:
        assert span.start_sample == cursor
        cursor += span.pcm.size
    assert cursor == 917 + pcm.size
    np.testing.assert_allclose(
        np.concatenate([s.pcm for s in whole]), np.concatenate([s.pcm for s in split]), atol=1e-6
    )
    # FIR delay compensation retains the phase and level of a speech-band tone.
    np.testing.assert_allclose(
        np.concatenate([s.pcm for s in whole])[200:-200], pcm[200:-200], atol=0.001
    )


@pytest.mark.parametrize("size", [1, 159, 160, 161, 481, 999])
def test_partial_frames_flush_exactly(size):
    output = suppress([np.full(size, 0.2, np.float32)])
    assert sum(span.pcm.size for span in output) == size


def test_reset_discards_tail_and_preserves_new_start():
    noise = NoiseSuppressor(native_factory=IdentityNative)
    noise.process(AudioSpan(0, np.ones(97, np.float32)))
    noise.reset()
    result = noise.process(AudioSpan(400, np.zeros(500, np.float32))) + noise.flush()
    assert result[0].start_sample == 400
    assert sum(s.pcm.size for s in result) == 500
    assert np.max(np.abs(np.concatenate([s.pcm for s in result]))) == 0


def test_limiter_and_invalid_input():
    output = suppress([np.full(3200, 4, np.float32)])
    pcm = np.concatenate([s.pcm for s in output])
    assert np.isfinite(pcm).all()
    assert np.max(np.abs(pcm)) <= 0.98
    noise = NoiseSuppressor(native_factory=IdentityNative)
    with pytest.raises(ValueError):
        noise.process(AudioSpan(0, np.array([np.nan], np.float32)))
    noise.process(AudioSpan(100, np.zeros(100, np.float32)))
    with pytest.raises(ValueError):
        noise.process(AudioSpan(201, np.zeros(100, np.float32)))
    noise.flush()
    with pytest.raises(RuntimeError):
        noise.process(AudioSpan(200, np.zeros(1, np.float32)))


def test_native_initialization_failure_is_explicit():
    def unavailable():
        raise OSError("missing native library")

    with pytest.raises(RuntimeError, match="noise suppression"):
        NoiseSuppressor(native_factory=unavailable)


def test_passthrough_preserves_samples_and_continuity():
    from sightline_speaker.noise import PassthroughSuppressor

    noise = PassthroughSuppressor()
    pcm = np.linspace(-0.5, 0.5, 320, dtype=np.float32)
    out = noise.process(AudioSpan(100, pcm))
    assert out[0].start_sample == 100 and np.array_equal(out[0].pcm, pcm)
    with pytest.raises(ValueError):
        noise.process(AudioSpan(999, pcm))
    assert noise.flush() == []


def test_noise_factory_modes():
    from sightline_speaker.noise import (
        NoiseSuppressor,
        PassthroughSuppressor,
        noise_factory,
        rnnoise_available,
    )

    assert noise_factory("off") is PassthroughSuppressor
    assert noise_factory("rnnoise") is NoiseSuppressor
    expected = NoiseSuppressor if rnnoise_available() else PassthroughSuppressor
    assert noise_factory("auto") is expected
    with pytest.raises(ValueError):
        noise_factory("loud")
