import cv2
import numpy as np
import pytest
from test_matching import textured_image

from flow import follow_flow


def test_region_motion_is_verified_with_forward_backward_feature_correspondences():
    image = textured_image()
    moved = cv2.warpAffine(image, np.float32([[1, 0, 15], [0, 1, 8]]), (320, 240))
    result = follow_flow(image, moved, (0.15, 0.15, 0.6, 0.7))
    assert result and result["score"] > 0.8 and result["inliers"] >= 8
    assert result["box"] == pytest.approx([0.196875, 0.183333, 0.646875, 0.733333], abs=0.01)


def test_blank_unrelated_and_featureless_regions_never_provide_flow_evidence():
    image = textured_image()
    assert follow_flow(image, np.zeros_like(image), (0.15, 0.15, 0.6, 0.7)) is None
    assert follow_flow(image, textured_image(88), (0.15, 0.15, 0.6, 0.7)) is None
    assert follow_flow(np.zeros_like(image), image, (0, 0, 1, 1)) is None


def test_small_rotations_do_not_repeatedly_expand_an_axis_aligned_region():
    image = textured_image()
    rotated = cv2.warpAffine(image, cv2.getRotationMatrix2D((160, 120), 5, 1), (320, 240))
    result = follow_flow(image, rotated, (0.15, 0.15, 0.6, 0.7))
    assert result
    assert result["box"][2] - result["box"][0] == pytest.approx(0.45, abs=0.01)
    assert result["box"][3] - result["box"][1] == pytest.approx(0.55, abs=0.01)
