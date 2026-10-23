import numpy as np


def test_numeric_forest_traverses_each_tree_and_preserves_mean_probability():
    from sign_service.landmark_pipeline import NumericForest

    forest = NumericForest(
        {
            "roots": np.array([0, 3]),
            "feature": np.array([0, -2, -2, 0, -2, -2]),
            "threshold": np.array([0.5, 0, 0, 0.2, 0, 0]),
            "left": np.array([1, -1, -1, 4, -1, -1]),
            "right": np.array([2, -1, -1, 5, -1, -1]),
            "probabilities": np.array(
                [[0, 0], [0.9, 0.1], [0.1, 0.9], [0, 0], [0.1, 0.9], [0.7, 0.3]]
            ),
            "classes": np.array([0, 1]),
        }
    )
    np.testing.assert_allclose(forest.predict_proba(np.array([0.1])), [0.5, 0.5])
    np.testing.assert_allclose(forest.predict_proba(np.array([0.8])), [0.4, 0.6])


def test_pixel_features_are_invariant_to_camera_resolution_and_translation():
    from sign_service.landmark_pipeline import pixel_features

    p = np.arange(63, dtype=np.float32).reshape(21, 3) / 200
    expected = pixel_features(p, 640, 480)
    np.testing.assert_allclose(pixel_features(p, 1280, 960), expected, atol=1e-6)
    np.testing.assert_allclose(pixel_features(p + [0.1, 0.1, 0], 640, 480), expected, atol=1e-6)


def test_pair_distances_are_mirror_invariant_without_dropping_directional_features():
    from sign_service.landmark_pipeline import forest_features

    p = np.arange(42, dtype=np.float32).reshape(21, 2)
    p -= p[0]
    p /= abs(p).max()
    mirrored = p.copy()
    mirrored[:, 0] *= -1
    original = forest_features(p.reshape(-1))
    flipped = forest_features(mirrored.reshape(-1))
    np.testing.assert_allclose(original[42:], flipped[42:])
    assert not np.array_equal(original[:42], flipped[:42])


def test_training_and_serving_use_identical_feature_representations():
    from sign_service.landmark_pipeline import forest_features
    from sign_service.train_landmarks import training_features

    rows = np.random.default_rng(19).uniform(-1, 1, (8, 42)).astype(np.float32)
    actual = np.array([forest_features(row) for row in rows])
    np.testing.assert_allclose(actual, training_features(rows), atol=1e-6)
