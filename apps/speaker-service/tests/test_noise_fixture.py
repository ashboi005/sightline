import numpy as np

from sightline_speaker.noise_fixture import augment


def test_noise_fixture_is_reproducible_and_has_one_complete_mixed_stream():
    mixed = np.sin(np.arange(16003) * 0.13).astype(np.float32) * 0.1
    noisy = augment(mixed, seed=20261004)
    np.testing.assert_array_equal(noisy, augment(mixed, seed=20261004))
    assert noisy.shape == mixed.shape
    assert np.isfinite(noisy).all()
    assert not np.array_equal(noisy, mixed)
    assert np.max(np.abs(noisy)) <= 0.98


def test_noise_mux_preserves_every_original_sample_including_partial_tail(tmp_path):
    from sightline_speaker.media import decode_media, run_media_command
    from sightline_speaker.noise_fixture import create_fixture

    source = tmp_path / "partial.mov"
    run_media_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=64x64:rate=15:duration=1.93",
            "-f",
            "lavfi",
            "-i",
            "sine=sample_rate=16000:duration=1.936",
            "-c:v",
            "libx264",
            "-c:a",
            "pcm_s16le",
            str(source),
        ]
    )
    original = decode_media(source)
    output = tmp_path / "noisy.mov"
    report = create_fixture(source, output)
    noisy = decode_media(output)
    assert report["sample_count"] == original.audio.size
    assert noisy.audio.size == original.audio.size
    np.testing.assert_array_equal(noisy.audio, augment(original.audio))
