"""Cached feature inference must agree with pinned Kornia's public forward."""

import copy

import cv2
import numpy as np
import pytest
import torch
from kornia.feature import LoFTR
from kornia.feature.loftr.loftr import default_cfg

from learned_correspondence import LearnedCorrespondence


@pytest.fixture
def matcher(monkeypatch):
    torch.manual_seed(7)
    torch.set_num_threads(4)
    config = copy.deepcopy(default_cfg)
    config["coarse"]["temp_bug_fix"] = True
    config["match_coarse"]["thr"] = 0
    instance = LearnedCorrespondence.__new__(LearnedCorrespondence)
    instance.device = "cpu"
    instance.model = LoFTR(pretrained=None, config=config).eval()
    monkeypatch.setattr(
        "learned_correspondence.view_size", lambda image: (image.shape[1], image.shape[0])
    )
    return instance


@pytest.mark.parametrize("size", [(64, 64), (96, 64)])
def test_cached_forward_matches_upstream_for_equal_and_different_image_shapes(matcher, size):
    source = np.random.default_rng(4).integers(0, 256, (64, 64, 3), dtype=np.uint8)
    target = cv2.resize(source, size)
    with torch.inference_mode():
        expected = matcher.model(
            {"image0": matcher.tensor(source), "image1": matcher.tensor(target)}
        )
    encoded = matcher.encode(source)
    before = (encoded.coarse.clone(), encoded.fine.clone())
    actual = matcher.match_encoded(encoded, matcher.encode(target))
    assert len(expected["keypoints0"]) > 0
    np.testing.assert_allclose(actual[0], expected["keypoints0"].numpy() / [64, 64], atol=1e-5)
    np.testing.assert_allclose(actual[1], expected["keypoints1"].numpy() / size, atol=1e-5)
    assert torch.equal(encoded.coarse, before[0])
    assert torch.equal(encoded.fine, before[1])


def test_new_target_and_masked_duplicate_search_never_reuse_target_features(matcher):
    source = np.random.default_rng(7).integers(0, 256, (64, 64, 3), dtype=np.uint8)
    changed = source.copy()
    changed[20:40, 20:40] = 0
    calls = []
    hook = matcher.model.backbone.register_forward_hook(lambda *args: calls.append(1))
    try:
        encoded = matcher.encode(source)
        for image in (source, changed, source):
            matcher.match_encoded(encoded, matcher.encode(image))
    finally:
        hook.remove()
    assert len(calls) == 4  # One immutable Source plus three independently encoded Target views.
