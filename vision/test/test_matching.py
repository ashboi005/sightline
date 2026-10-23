import cv2
import numpy as np
import pytest

from matching import Candidate, Reference, choose_match, valid_box


def textured_image(seed=42):
    random = np.random.default_rng(seed)
    image = np.full((240, 320, 3), 35, np.uint8)
    for _ in range(160):
        x, y = random.integers([20, 20], [300, 220])
        color = tuple(int(c) for c in random.integers(60, 255, 3))
        cv2.circle(image, (int(x), int(y)), int(random.integers(2, 8)), color, -1)
    return image


def test_instance_geometry_matches_translation_and_rejects_unrelated_texture():
    image = textured_image()
    reference = Reference(image, (0.02, 0.02, 0.98, 0.98))
    moved = cv2.warpAffine(image, np.float32([[1, 0, 6], [0, 1, -4]]), (320, 240))
    result = choose_match(reference, moved, [Candidate((0, 0, 1, 1), 0.9)])
    assert result["status"] == "matched"
    assert result["score"] > 0.8
    assert result["inliers"] >= 8
    assert (
        choose_match(reference, textured_image(88), [Candidate((0, 0, 1, 1), 0.9)])["status"]
        == "searching"
    )
    assert (
        choose_match(reference, np.zeros_like(image), [Candidate((0, 0, 1, 1), 0.9)])["status"]
        == "searching"
    )


def test_low_texture_does_not_claim_a_match():
    image = np.full((240, 320, 3), 100, np.uint8)
    result = choose_match(Reference(image, (0, 0, 1, 1)), image, [Candidate((0, 0, 1, 1), 0.9)])
    assert result["status"] == "searching"
    assert "box" not in result


def test_two_equal_instances_are_ambiguous():
    image = textured_image()
    duplicate = np.concatenate([image, image], axis=1)
    result = choose_match(
        Reference(image, (0, 0, 1, 1)),
        duplicate,
        [Candidate((0, 0, 0.5, 1), 0.9), Candidate((0.5, 0, 1, 1), 0.9)],
    )
    assert result["status"] == "ambiguous"
    assert "box" not in result


@pytest.mark.parametrize(
    "box", [(0, 0, 0, 1), (-0.1, 0, 1, 1), (0, 0, float("nan"), 1), (0, 1, 1, 0)]
)
def test_invalid_boxes_rejected(box):
    with pytest.raises(ValueError):
        valid_box(box)


def test_selected_part_is_located_inside_a_larger_view_without_expanding_to_its_container():
    image = textured_image()
    reference = Reference(image, (0.15, 0.15, 0.6, 0.7))
    moved = cv2.warpAffine(image, np.float32([[1, 0, 15], [0, 1, 8]]), (320, 240))
    result = choose_match(reference, moved, [Candidate((0, 0, 1, 1), 0.0)])
    assert result["status"] == "matched"
    assert result["box"][0] == pytest.approx(0.196875, abs=0.035)
    assert result["box"][1] == pytest.approx(0.183333, abs=0.035)
    assert result["box"][2] == pytest.approx(0.646875, abs=0.035)
    assert result["box"][3] == pytest.approx(0.733333, abs=0.035)


def test_overlapping_detector_proposals_are_not_treated_as_two_different_instances():
    image = textured_image()
    result = choose_match(
        Reference(image, (0, 0, 1, 1)),
        image,
        [Candidate((0, 0, 1, 1), 0.9), Candidate((0, 0, 1, 1), 0.8)],
    )
    assert result["status"] == "matched"


def test_global_search_does_not_arbitrarily_choose_a_transformed_duplicate():
    image = textured_image()
    other = cv2.warpAffine(image, cv2.getRotationMatrix2D((160, 120), 2, 0.95), (320, 240))
    result = choose_match(
        Reference(image, (0, 0, 1, 1)),
        np.concatenate([image, other], axis=1),
        [Candidate((0, 0, 1, 1), 0)],
    )
    assert result["status"] == "ambiguous"
    assert "box" not in result


def test_sparse_correspondences_cannot_extrapolate_an_unstable_extent():
    from matching import stable_projection

    source = np.float32([[x, y] for x in (60, 80, 100, 120) for y in (60, 80, 100)])
    destination = source + [10, 20]
    corners = np.float32([[0, 0], [200, 0], [200, 180], [0, 180]]).reshape(-1, 1, 2)
    assert stable_projection(source, destination, corners, corners + [10, 20])
    assert not stable_projection(source, destination, corners, corners * 3 + [10, 20])


def test_fractional_region_coordinates_use_the_same_pixel_rounding_as_tracker_initialization():
    image = np.zeros((240, 320, 3), np.uint8)
    image[50:180, 60:160] = [70, 120, 220]
    reference = Reference(image, (0.1875, 0.208333, 0.5, 0.75))
    assert reference.image.shape == (130, 100, 3)
    assert tuple(reference.image[0, 0]) == (70, 120, 220)


def test_a_subpixel_region_at_the_image_edge_keeps_one_valid_pixel():
    image = np.full((60, 80, 3), 100, np.uint8)
    reference = Reference(image, (0.9999, 0.9999, 1, 1))
    assert reference.image.shape == (1, 1, 3)
    assert tuple(reference.image[0, 0]) == (100, 100, 100)
    assert reference.compare(image, Candidate((0, 0, 1, 1), 0.9)) is None
    detailed = Reference(textured_image(), (0, 0, 1, 1))
    assert detailed.compare(image, Candidate((0.9999, 0.9999, 1, 1), 0.9)) is None
