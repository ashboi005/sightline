import importlib

import numpy as np
import pytest


def model_api():
    try:
        return importlib.import_module("sightline_speaker.model")
    except ModuleNotFoundError:
        pytest.fail("pretrained separator boundary is not implemented")


def test_missing_assets_cannot_start_a_separator(tmp_path):
    with pytest.raises(FileNotFoundError, match="asset|checkpoint"):
        model_api().Separator.load(tmp_path, "cpu")


@pytest.mark.parametrize("bad_audio", [np.array([np.nan]), np.zeros((2, 32000)), np.array([])])
def test_rejects_invalid_audio_before_model_execution(bad_audio):
    with pytest.raises(ValueError, match="audio"):
        model_api().validate_inputs(bad_audio, np.zeros((50, 88, 88), dtype=np.float32))


def test_rejects_misaligned_visual_sequence():
    with pytest.raises(ValueError, match="frame|video"):
        model_api().validate_inputs(np.zeros(32000), np.zeros((10, 88, 88)))


def test_rejects_nonfinite_visual_input():
    frames = np.zeros((50, 88, 88), dtype=np.float32)
    frames[0, 0, 0] = np.nan
    with pytest.raises(ValueError, match="frame|video"):
        model_api().validate_inputs(np.zeros(32000), frames)


@pytest.mark.model
def test_real_pretrained_output_preserves_audio_length():
    import os
    from pathlib import Path

    if os.environ.get("SPEAKER_MODEL_TESTS") != "1":
        pytest.skip("explicit real-model smoke check")
    separator = model_api().Separator.load(Path("data/assets"), "cpu")
    audio = np.random.default_rng(4).normal(0, 0.01, 32000).astype(np.float32)
    frames = np.zeros((50, 88, 88), dtype=np.float32)
    output = separator.extract(audio, frames)
    assert output.shape == (32000,)
    assert output.dtype == np.float32
    assert np.isfinite(output).all()
    assert not np.array_equal(output, audio)


@pytest.mark.model
def test_visual_mps_acceleration_matches_cpu_extraction():
    import os
    from pathlib import Path

    import torch

    if os.environ.get("SPEAKER_MODEL_TESTS") != "1" or not torch.backends.mps.is_available():
        pytest.skip("explicit Apple Silicon parity check")
    cpu = model_api().Separator.load(Path("data/assets"), "cpu")
    accelerated = model_api().Separator.load(Path("data/assets"), "auto")
    assert accelerated.visual_device == "mps"
    assert accelerated.audio_device == "cpu"
    audio = np.random.default_rng(4).normal(0, 0.01, 32000).astype(np.float32)
    frames = np.random.default_rng(5).normal(0, 0.2, (50, 88, 88)).astype(np.float32)
    reference = cpu.extract(audio, frames)
    actual = accelerated.extract(audio, frames)
    np.testing.assert_allclose(actual, reference, atol=2e-4, rtol=2e-3)
