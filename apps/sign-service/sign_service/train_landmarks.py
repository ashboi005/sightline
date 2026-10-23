"""Reproduce the bundled model using public training data only.

uv run --group training python -m sign_service.train_landmarks --data path/to/keypoint.csv
No video input, filenames, phrase targets or acceptance labels are accepted.
"""

import argparse
import csv
import hashlib
import json
from pathlib import Path

import numpy as np

SOURCE_REVISION = "a66dd63ad597a023941f5ad90603aa267767d2ed"
SOURCE_HASH = "b6922d3b38c0072ba367e89e17bd4fe174f0adb2928d0371c5152c1fc5068847"


def training_features(rows):
    points = rows.reshape(-1, 21, 2)
    i, j = np.triu_indices(21, k=1)
    distances = np.linalg.norm(points[:, i] - points[:, j], axis=-1)
    scale = np.maximum(np.linalg.norm(points[:, 9], axis=-1), 1e-6)
    return np.concatenate([rows, distances / scale[:, None]], axis=1)


def export_forest(model, directory):
    offsets = np.cumsum([0, *[e.tree_.node_count for e in model.estimators_[:-1]]]).astype(np.int32)
    feature, threshold, left, right, probabilities = [], [], [], [], []
    for estimator, offset in zip(model.estimators_, offsets, strict=True):
        tree = estimator.tree_
        feature.append(tree.feature.astype(np.int16))
        threshold.append(tree.threshold)
        left.append(
            np.where(tree.children_left < 0, -1, tree.children_left + offset).astype(np.int32)
        )
        right.append(
            np.where(tree.children_right < 0, -1, tree.children_right + offset).astype(np.int32)
        )
        value = tree.value[:, 0, :]
        value = value / np.maximum(value.sum(axis=1, keepdims=True), 1e-12)
        probabilities.append(value.astype(np.float32))
    path = directory / "forest.npz"
    np.savez_compressed(
        path,
        roots=offsets,
        feature=np.concatenate(feature),
        threshold=np.concatenate(threshold),
        left=np.concatenate(left),
        right=np.concatenate(right),
        probabilities=np.concatenate(probabilities),
        classes=model.classes_.astype(np.int16),
    )
    return path


def main():
    import sklearn
    from sklearn.ensemble import ExtraTreesClassifier

    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, default=root / ".data/retrained-forest")
    args = parser.parse_args()
    with args.data.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != SOURCE_HASH:
            parser.error("Use the pinned public CSV; data hash does not match")
    with args.data.open(newline="", encoding="utf-8") as source:
        rows = np.array([row for row in csv.reader(source) if len(row) == 43], dtype=np.float32)
    if not np.isfinite(rows).all() or len(rows) != 36401:
        parser.error("Unexpected single-hand training rows")
    x, y = rows[:, 1:], rows[:, 0].astype(int)
    flipped = x.copy()
    flipped[:, ::2] *= -1
    model = ExtraTreesClassifier(
        n_estimators=160,
        max_depth=24,
        min_samples_leaf=2,
        n_jobs=4,
        random_state=42,
        max_features=0.5,
    )
    model.fit(training_features(np.concatenate([x, flipped])), np.concatenate([y, y]))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    asset = export_forest(model, args.out_dir)
    metadata = dict(
        training_source="https://github.com/Muhib-Mehdi/ASL-Recognition-System",
        revision=SOURCE_REVISION,
        data_path="model/keypoint_classifier/keypoint.csv",
        data_sha256=SOURCE_HASH,
        single_hand_rows=len(rows),
        training_augmentations=["horizontal mirror"],
        features="42 wrist-relative max-abs-normalized pixel coordinates + 210 palm-normalized pair distances",
        estimator="ExtraTreesClassifier",
        n_estimators=160,
        max_depth=24,
        min_samples_leaf=2,
        max_features=0.5,
        random_state=42,
        sklearn_version=sklearn.__version__,
        acceptance_video_used_for_training=False,
        sha256=hashlib.sha256(asset.read_bytes()).hexdigest(),
    )
    (args.out_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(metadata, indent=2), flush=True)


if __name__ == "__main__":
    main()
