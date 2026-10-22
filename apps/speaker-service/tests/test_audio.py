import importlib
from pathlib import Path

import numpy as np
import pytest

from sightline_speaker.faces import FaceObservation, FaceTrack, mouth_sequence
from sightline_speaker.media import DecodedMedia


def api():
    try:
        return importlib.import_module("sightline_speaker.audio")
    except ModuleNotFoundError:
        pytest.fail("chunked extraction is not implemented")


def media(seconds=2.3):
    count = round(seconds * 25)
    return DecodedMedia(
        Path("unused"),
        np.full(round(seconds * 16000), 0.2, np.float32),
        [np.zeros((64, 64, 3), np.uint8)] * count,
        np.arange(count) / 25,
        64,
        64,
        seconds,
    )


def track(times):
    anchors = np.array([[32, 35], [19, 25], [26, 25], [38, 25], [45, 25]], np.float32)
    return FaceTrack(
        "test",
        [FaceObservation(t, (0.1, 0.1, 0.8, 0.8), anchors, np.array([32, 45])) for t in times],
    )


def test_overlap_add_keeps_constant_audio_without_boundary_dips():
    module = api()
    windows = [
        module.AudioWindow(start, np.full(32000, 0.25, np.float32)) for start in [0, 16000, 32000]
    ]
    output = module.assemble_windows(windows, 37000)
    assert output.shape == (37000,)
    np.testing.assert_allclose(output, 0.25, atol=1e-6)


def test_uncovered_output_is_rejected_instead_of_returned_as_fake_silence():
    module = api()
    with pytest.raises(ValueError, match="coverage"):
        module.assemble_windows([module.AudioWindow(16000, np.ones(32000))], 48000)


def test_exact_tail_length_and_progress(monkeypatch):
    module = api()
    monkeypatch.setattr(module, "prepare_frames", lambda *args: np.zeros((50, 88, 88), np.float32))

    class Model:
        def extract(self, audio, mouth):
            assert audio.size == 32000
            return audio * 2

    updates = []
    result = module.extract_track(media(), track([0]), Model(), lambda: False, updates.append)
    assert result.audio.shape == (36800,)
    np.testing.assert_allclose(result.audio, 0.4, atol=1e-6)
    assert updates[-1] == 1
    assert len(result.window_seconds) == 3


def test_cancel_during_inference_does_not_publish_partial_audio(monkeypatch):
    module = api()
    monkeypatch.setattr(module, "prepare_frames", lambda *args: np.zeros((50, 88, 88), np.float32))
    cancelled = False

    class Model:
        def extract(self, audio, mouth):
            nonlocal cancelled
            cancelled = True
            return audio

    with pytest.raises(module.ExtractionCancelled):
        module.extract_track(media(), track([0]), Model(), lambda: cancelled, lambda _: None)


def test_invalid_model_output_is_not_published(monkeypatch):
    module = api()
    monkeypatch.setattr(module, "prepare_frames", lambda *args: np.zeros((50, 88, 88), np.float32))

    class Model:
        def extract(self, audio, mouth):
            return np.full_like(audio, np.nan)

    with pytest.raises(ValueError, match="finite"):
        module.extract_track(media(), track([0]), Model(), lambda: False, lambda _: None)


def test_output_peak_is_limited_without_sample_clipping(monkeypatch):
    module = api()
    monkeypatch.setattr(module, "prepare_frames", lambda *args: np.zeros((50, 88, 88), np.float32))

    class Model:
        def extract(self, audio, mouth):
            return audio * 10

    result = module.extract_track(media(), track([0]), Model(), lambda: False, lambda _: None)
    assert np.max(np.abs(result.audio)) <= 0.98 + 1e-6
    assert result.gain < 1


def test_visual_context_padding_repeats_eof_only():
    sample = media(0.4)
    output = mouth_sequence(sample, track(sample.timestamps), 0, 2)
    assert output.shape == (50, 88, 88)
    np.testing.assert_array_equal(output[-1], output[9])


def test_missing_mouth_inside_real_clip_pauses_extraction():
    sample = media(2)
    with pytest.raises(ValueError, match="lost"):
        mouth_sequence(sample, track([0, 0.1, 0.2, 1.8, 1.9]), 0, 2)


@pytest.mark.parametrize("width,height", [(64, 64), (65, 63)])
def test_real_vp8_webm_exports_playable_mp4_and_keeps_waveform(tmp_path, width, height):
    import json
    import subprocess

    import soundfile as sf

    from sightline_speaker.benchmark import export_result
    from sightline_speaker.media import run_media_command

    source = tmp_path / "vp8.webm"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size={width}x{height}:rate=10:duration=0.6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000:duration=0.6",
            "-c:v",
            "libvpx",
            "-c:a",
            "libopus",
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    samples = np.full(9600, 0.2, np.float32)
    result = api().ExtractionResult(samples, 0.1, [0.1], 2.0, 1.0, 1.0)
    wav, preview = export_result(source, result, tmp_path / "export")
    actual, rate = sf.read(wav)
    assert rate == 16000 and len(actual) == 9600
    np.testing.assert_allclose(actual, 0.2, atol=4e-5)
    probe = json.loads(
        run_media_command(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(preview)])
    )
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert video["codec_name"] == "h264"
    assert video["width"] == width + width % 2
    assert video["height"] == height + height % 2
