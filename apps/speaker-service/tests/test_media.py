import importlib

import numpy as np
import pytest


def media_api():
    try:
        return importlib.import_module("sightline_speaker.media")
    except ModuleNotFoundError:
        pytest.fail("timestamped media preparation is not implemented")


def test_variable_rate_video_uses_nearest_presentation_time():
    indices = media_api().nearest_frame_indices(
        np.array([0.0, 0.067, 0.134, 0.20]), np.array([0.0, 0.04, 0.08, 0.12, 0.16, 0.20])
    )
    assert indices.tolist() == [0, 1, 1, 2, 2, 3]


def test_nonmonotonic_frame_timestamps_are_rejected():
    with pytest.raises(ValueError, match="timestamp"):
        media_api().nearest_frame_indices(np.array([0.0, 0.1, 0.05]), np.array([0.04]))


def test_audio_start_offset_is_preserved():
    padded = media_api().align_audio(np.array([0.25, 0.5], dtype=np.float32), 0.1, 10)
    assert padded.tolist() == [0.0, 0.25, 0.5]


def test_decode_budget_rejects_unbounded_duration():
    with pytest.raises(ValueError, match="duration"):
        media_api().validate_media_info(121.0, 320, 180, media_api().MediaLimits())


def test_decode_budget_rejects_huge_dimensions():
    with pytest.raises(ValueError, match="dimension"):
        media_api().validate_media_info(2.0, 20000, 180, media_api().MediaLimits())


def test_real_decoder_preserves_delayed_audio(offset_video):
    media = media_api().decode_media(offset_video)
    assert len(media.frames) == 6
    assert media.timestamps[0] == 0.0
    assert np.max(np.abs(media.audio[:2700])) < 1e-5
    assert np.max(np.abs(media.audio[4000:4800])) > 0.05


def test_real_decoder_enforces_frame_limit(offset_video):
    with pytest.raises(ValueError, match="frame count"):
        media_api().decode_media(offset_video, media_api().MediaLimits(max_frames=2))


def test_real_decoder_enforces_pixel_budget(offset_video):
    with pytest.raises(ValueError, match="pixels"):
        media_api().decode_media(offset_video, media_api().MediaLimits(max_decoded_pixels=100))


def test_real_decoder_rejects_internal_audio_timestamp_gap(tmp_path):
    import subprocess

    path = tmp_path / "audio-gap.mkv"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=64x64:rate=10:duration=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000:duration=2",
            "-filter_complex",
            r"[1:a]asetpts=PTS+gte(T\,1)/TB[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-c:a",
            "pcm_s16le",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    with pytest.raises(ValueError, match="synchronization"):
        media_api().decode_media(path)
