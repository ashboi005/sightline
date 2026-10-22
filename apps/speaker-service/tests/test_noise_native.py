from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from scipy.signal import correlate, correlation_lags

from sightline_speaker.noise import NoiseSuppressor, rnnoise_available
from sightline_speaker.stream_profile import AudioSpan

pytestmark = pytest.mark.skipif(
    not rnnoise_available(),
    reason="native RNNoise wheel unavailable (Linux, Windows, macOS 26+ only)",
)


def enhance(pcm):
    noise = NoiseSuppressor()
    try:
        parts = []
        for start in range(0, pcm.size, 997):
            parts.extend(noise.process(AudioSpan(start, pcm[start : start + 997])))
        parts.extend(noise.flush())
        return np.concatenate([s.pcm for s in parts])
    finally:
        noise.close()


def test_native_runs_and_conserves_source_duration():
    pcm = np.random.default_rng(12).normal(0, 0.02, 16019).astype(np.float32)
    result = enhance(pcm)
    assert result.size == pcm.size
    assert np.isfinite(result).all()
    assert np.max(np.abs(result)) <= 0.98
    assert np.sqrt(np.mean(result[8000:] ** 2)) < np.sqrt(np.mean(pcm[8000:] ** 2)) * 0.5


def test_native_speech_alignment_and_noise_reduction():
    path = Path("data/evaluation/ground-truth/female.wav")
    if not path.exists():
        pytest.skip("explicit GRID evaluation fixtures are not installed")
    speech, rate = sf.read(path, dtype="float32")
    assert rate == 16000
    clean = np.concatenate((np.zeros(16000, np.float32), speech, np.zeros(16000, np.float32)))
    rng = np.random.default_rng(20261004)
    noise = rng.normal(0, 0.025, clean.size).astype(np.float32)
    enhanced_clean = enhance(clean)
    enhanced = enhance(clean + noise)
    correlation = correlate(enhanced_clean, clean, mode="full", method="fft")
    lag = correlation_lags(clean.size, clean.size)[np.argmax(correlation)]
    assert abs(lag) <= 3
    noise_rms = np.sqrt(np.mean(enhanced[-8000:] ** 2))
    assert noise_rms < 0.0125
    region = slice(16000, 16000 + speech.size)
    # Compare enhanced noisy speech with native clean speech, preserving high-band consonants.
    from scipy.signal import butter, sosfilt

    highpass = butter(4, 1800, fs=16000, btype="highpass", output="sos")
    a = sosfilt(highpass, enhanced_clean[region])
    b = sosfilt(highpass, enhanced[region])
    assert np.corrcoef(a, b)[0, 1] > 0.65
    print(
        {
            "native_lag_samples": int(lag),
            "noise_rms": float(noise_rms),
            "consonant_band_correlation": float(np.corrcoef(a, b)[0, 1]),
        }
    )
