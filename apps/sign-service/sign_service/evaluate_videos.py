"""Evaluate the production alphabet path; filenames supply scoring labels only."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


def letters(text):
    return re.sub("[^A-Z]", "", text.upper())


def evaluate(path, pipeline, fps=12):
    import cv2

    from .alphabet_recognizer import AlphabetRecognizer
    from .decoding import PhraseDecoder
    from .types import continuity_gap_ms

    recognizer = AlphabetRecognizer(pipeline)
    if recognizer.load_error:
        raise RuntimeError(recognizer.load_error)
    decoder = PhraseDecoder(
        fingerspell_threshold=recognizer.confidence_threshold,
        spelling_decoder=recognizer.spelling_decoder,
        max_evidence_gap_ms=continuity_gap_ms(fps),
    )
    recognizer.configure_frame_rate(fps)
    cap = cv2.VideoCapture(str(path))
    source_fps = cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or source_fps <= 0:
        cap.release()
        recognizer.close()
        raise ValueError(f"Unreadable video: {path}")
    step = max(1, round(source_fps / fps))
    frames, messages = [], []
    index, last_t = 0, 0
    try:
        while True:
            ok, image = cap.read()
            if not ok:
                break
            index += 1
            if (index - 1) % step:
                continue
            t = (index - 1) / source_fps
            last_t = t
            scale = min(640 / image.shape[1], 480 / image.shape[0], 1)
            image = cv2.resize(image, None, fx=scale, fy=scale)
            encoded, jpeg = cv2.imencode(".jpg", image)
            if not encoded:
                raise ValueError("JPEG encoding failed")
            result = recognizer.track(jpeg.tobytes(), round(t * 1000))
            messages += decoder.hands(result.hands_detected, t, round(t * 1000))
            prediction = None
            if result.observation is not None:
                evidence = recognizer.predict(result.observation)
                prediction = evidence.prediction
                messages += decoder.prediction(prediction, evidence.observation, round(t * 1000))
            frames.append(
                dict(
                    t=round(t, 3),
                    hands=result.hands_detected,
                    letter=prediction.gloss if prediction else None,
                    confidence=prediction.confidence if prediction else None,
                )
            )
        messages += decoder.hands(0, last_t + 0.01, round((last_t + 0.01) * 1000))
        messages += decoder.hands(0, last_t + 1.1, round((last_t + 1.1) * 1000))
    finally:
        cap.release()
        recognizer.close()
    tokens = [message["token"]["gloss"] for message in messages if message["type"] == "sign.token"]
    observed = "".join(tokens)
    spelling_results = list(decoder.spelling_results)
    raw_observed = (
        "".join(item.raw_letters for item in spelling_results) if spelling_results else observed
    )
    text = " ".join(item.text for item in spelling_results) if spelling_results else observed
    # Ground truth is first accessed after all inference and decoding finish.
    expected = letters(path.stem)
    with path.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
    return dict(
        video=path.name,
        sha256=digest,
        expected=expected,
        observed=observed,
        passed=observed == expected,
        raw_observed=raw_observed,
        raw_passed=raw_observed == expected,
        text=text,
        language_assisted=any(item.used_language_model for item in spelling_results),
        tokens=tokens,
        sampled_frames=len(frames),
        hands_frames=sum(bool(frame["hands"]) for frame in frames),
        frames=frames,
    )


def main():
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "directory", nargs="?", type=Path, default=root / "apps/sign-service/test_data"
    )
    parser.add_argument("--report", type=Path, default=root / ".data/alphabet-video-report.json")
    parser.add_argument("--offline", action="store_true", help="compatibility flag; assets are local")
    parser.add_argument("--fps", type=int, default=12)
    args = parser.parse_args()
    if not 1 <= args.fps <= 30:
        parser.error("fps must be between 1 and 30")
    paths = (
        [args.directory]
        if args.directory.is_file()
        else sorted(
            path
            for path in args.directory.iterdir()
            if path.suffix.lower() in {".mp4", ".mov", ".avi"}
        )
    )
    if not paths:
        parser.error("no test videos found")
    from .landmark_pipeline import LandmarkPipeline

    pipeline = LandmarkPipeline()
    pipeline.ensure_loaded()
    if pipeline.load_error:
        raise RuntimeError(pipeline.load_error)
    results = []
    try:
        for path in paths:
            result = evaluate(path, pipeline, args.fps)
            results.append(result)
            print(json.dumps({k: v for k, v in result.items() if k != "frames"}), flush=True)
    finally:
        pipeline.close()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = dict(
        model=pipeline.model_name,
        alphabet_only=True,
        scoring="backend-decoded letters; raw visual letters are reported separately",
        fps=args.fps,
        confidence_threshold=pipeline.confidence_threshold,
        minimum_stability_frames=4,
        letter_hold_ms=1000,
        motion_filter=True,
        results=results,
    )
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Report: {args.report}", flush=True)
    return 0 if all(result["passed"] for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
