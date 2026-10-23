import cv2
import numpy as np

from appearance import choose_appearance
from matching import Reference


def folded():
    random = np.random.default_rng(4)
    patch = cv2.GaussianBlur(random.integers(0, 255, (80, 120), dtype=np.uint8), (0, 0), 3)
    patch = cv2.normalize(patch, None, 15, 85, cv2.NORM_MINMAX)
    image = np.full((240, 320, 3), 170, np.uint8)
    image[80:160, 60:180] = cv2.cvtColor(patch, cv2.COLOR_GRAY2BGR)
    return image


def test_dense_fold_detail_matches_without_needing_orb_corners():
    image = folded()
    moved = cv2.warpAffine(
        image, np.float32([[1, 0, 40], [0, 1, 20]]), (320, 240), borderValue=(170, 170, 170)
    )
    result = choose_appearance(Reference(image, (60 / 320, 80 / 240, 180 / 320, 160 / 240)), moved)
    assert result["status"] == "matched"
    assert result["method"] == "appearance"
    assert result["score"] > 0.92
    assert result["box"] == [100 / 320, 100 / 240, 220 / 320, 180 / 240]


def test_uniform_and_duplicate_appearances_do_not_claim_a_unique_match():
    uniform = np.full((240, 320, 3), 100, np.uint8)
    assert choose_appearance(Reference(uniform, (0, 0, 1, 1)), uniform) == {"status": "searching"}
    image = folded()
    duplicate = np.concatenate([image, image], axis=1)
    result = choose_appearance(
        Reference(image, (60 / 320, 80 / 240, 180 / 320, 160 / 240)), duplicate
    )
    assert result["status"] == "ambiguous"
    assert "box" not in result


def test_rotated_smooth_region_uses_interior_detail_with_bounded_resolution():
    image = cv2.resize(folded(), (960, 720))
    transformed = cv2.warpAffine(
        image, cv2.getRotationMatrix2D((480, 360), 3, 0.98), (960, 720), borderValue=(170, 170, 170)
    )
    result = choose_appearance(
        Reference(image, (60 / 320, 80 / 240, 180 / 320, 160 / 240)), transformed
    )
    assert result["status"] == "matched"
    assert result["score"] > 0.92


def small_object():
    patch = np.random.default_rng(71).integers(0, 255, (24, 16, 3), dtype=np.uint8)
    scene = np.full((240, 640, 3), 170, np.uint8)
    scene[40:64, 80:96] = patch
    target = np.full_like(scene, 170)
    target[120:144, 400:416] = patch
    return scene, target


def test_small_detailed_object_is_searched_without_discarding_its_pixels():
    scene, target = small_object()
    result = choose_appearance(Reference(scene, (80 / 640, 40 / 240, 96 / 640, 64 / 240)), target)
    assert result["status"] == "matched"
    assert result["box"] == [400 / 640, 120 / 240, 416 / 640, 144 / 240]
    assert result["score"] > 0.92


def test_small_identical_objects_remain_ambiguous():
    scene, target = small_object()
    target[120:144, 200:216] = target[120:144, 400:416]
    result = choose_appearance(Reference(scene, (80 / 640, 40 / 240, 96 / 640, 64 / 240)), target)
    assert result == {"status": "ambiguous"}
