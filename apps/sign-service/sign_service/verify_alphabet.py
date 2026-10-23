"""Execution/provenance check for the active numeric alphabet model, not accuracy."""

import argparse
import json
import statistics
import time
from pathlib import Path

import numpy as np

from .landmark_pipeline import ASSETS, LandmarkPipeline
from .types import LandmarkInput


def main():
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="assets are bundled; always offline")
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--report", type=Path, default=root / ".data/alphabet-model-report.json")
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("iterations must be positive")
    pipeline = LandmarkPipeline()
    try:
        pipeline.ensure_loaded()
        if pipeline.load_error:
            raise RuntimeError(pipeline.load_error)
        features = np.arange(42, dtype=np.float32).reshape(21, 2)
        features -= features[0]
        features /= abs(features).max()
        sample = LandmarkInput(features.reshape(42), 0, 0)
        for _ in range(3):
            pipeline.infer(sample)
        timings = []
        for _ in range(args.iterations):
            started = time.perf_counter()
            pipeline.infer(sample)
            timings.append((time.perf_counter() - started) * 1000)
        report = dict(
            model=pipeline.model_name,
            alphabet_only=True,
            classifier_count=1,
            device="cpu",
            dtype="float32 features / native forest probabilities",
            vocabulary=pipeline.vocabulary,
            median_ms=statistics.median(timings),
            accuracy_evaluated=False,
            input="synthetic landmark features",
            model_asset_bytes=(ASSETS / "forest.npz").stat().st_size,
            training=json.loads((ASSETS / "metadata.json").read_text(encoding="utf-8")),
            language_decoder="generic English frequencies; spaces/repeated-letter insertion only",
        )
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
    finally:
        pipeline.close()


if __name__ == "__main__":
    main()
