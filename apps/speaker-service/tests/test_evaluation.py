from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from sightline_speaker.benchmark import si_sdr
from sightline_speaker.evaluation import prepare_mixture
from sightline_speaker.media import decode_media


@pytest.mark.skipif(
    not Path("data/evaluation/sources/grid-male.mpg").exists(),
    reason="official examples not downloaded",
)
def test_independent_mixture_contains_both_stems_with_one_audio_stream(tmp_path):
    import shutil

    (tmp_path / "sources").mkdir()
    for name in ["male", "female"]:
        shutil.copyfile(
            f"data/evaluation/sources/grid-{name}.mpg", tmp_path / "sources" / f"grid-{name}.mpg"
        )
    mixture, paths = prepare_mixture(tmp_path)
    decoded = decode_media(mixture)
    stems = [sf.read(path)[0] for path in paths]
    expected = stems[0] + stems[1]
    assert decoded.audio.shape == expected.shape
    np.testing.assert_allclose(decoded.audio, expected, atol=4e-5)
    assert max(si_sdr(stem, decoded.audio) for stem in stems) < 0.2
    assert decoded.width == 320 and decoded.height == 180
