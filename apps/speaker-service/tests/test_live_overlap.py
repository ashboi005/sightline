import importlib

import numpy as np
import pytest


def modules():
    try:
        return (
            importlib.import_module("sightline_speaker.live_overlap"),
            importlib.import_module("sightline_speaker.stream_profile"),
        )
    except ImportError:
        pytest.fail("Sample-based general overlap assembly is missing")


@pytest.mark.parametrize("window,stride,length", [(48000, 28800, 100003), (32000, 16000, 70007)])
def test_weighted_overlap_emits_each_source_sample_once(window, stride, length):
    overlap_module, profiles = modules()
    overlap = overlap_module.LiveOverlap(profiles.StreamProfile(window, stride))
    spans = []
    for start in range(123, 123 + length, stride):
        valid = min(window, 123 + length - start)
        pcm = np.zeros(window, dtype=np.float32)
        pcm[:valid] = 0.2
        spans.extend(overlap.push(start, pcm, source_end_sample=123 + length))
    spans.extend(overlap.flush(123 + length))
    assert spans[0].start_sample == 123
    cursor = 123
    for span in spans:
        assert span.start_sample == cursor
        cursor += span.pcm.size
    joined = np.concatenate([span.pcm for span in spans])
    assert cursor == 123 + length
    assert joined.size == length
    assert np.allclose(joined, 0.2, atol=1e-6)
    assert overlap.flush(123 + length) == []


def test_overlap_rejects_duplicate_and_nonfinite_results():
    module, profiles = modules()
    overlap = module.LiveOverlap(profiles.StreamProfile(32000, 16000))
    overlap.push(0, np.zeros(32000, dtype=np.float32))
    with pytest.raises(ValueError, match="contiguous"):
        overlap.push(0, np.zeros(32000, dtype=np.float32))
    invalid = np.zeros(32000, dtype=np.float32)
    invalid[10] = np.nan
    with pytest.raises(ValueError, match="finite"):
        overlap.push(16000, invalid)


def test_generation_reset_discards_previous_voice_tail():
    module, profiles = modules()
    overlap = module.LiveOverlap(profiles.StreamProfile(32000, 16000))
    overlap.push(0, np.ones(32000, dtype=np.float32) * 0.8)
    overlap.reset()
    span = overlap.push(90000, np.zeros(32000, dtype=np.float32))[0]
    assert span.start_sample == 90000
    assert np.all(span.pcm == 0)
