"""Local, per-region motion evaluation with hand-labeled checkpoint IoU.

Scene and Target use independent tracking state from one supplied recording.
Identical frames are the default; transformed copies remain an optional stress test.
Neither mode measures unseen 3-D viewpoints or calibrated identity probability.
"""

import argparse
import json
import math
import re
import statistics
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

from engine import VisionEngine
from matching import box_overlap, valid_box


def overlap(box, truth):
    return box_overlap(box, truth) if box else 0.0


def validate_cases(cases, duration):
    if not isinstance(cases, list) or not cases:
        raise ValueError("Provide a non-empty case list.")
    names = set()
    for case in cases:
        if not isinstance(case, dict) or not re.fullmatch(
            r"[a-z][a-z0-9_-]{0,39}", str(case.get("name", ""))
        ):
            raise ValueError("Use a short, unique case name without path separators.")
        if case["name"] in names:
            raise ValueError("Case names must be unique.")
        names.add(case["name"])
        start, end = case.get("start"), case.get("end")
        if (
            not all(
                isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
                for x in (start, end)
            )
            or not 0 <= start < end <= duration
        ):
            raise ValueError("Case interval is outside the video.")
        valid_box(case.get("box"))
        truth = case.get("truth", {})
        if not isinstance(truth, dict):
            raise ValueError("Truth must map seconds to normalized boxes.")
        for second, box in truth.items():
            if not start <= float(second) <= end:
                raise ValueError("Truth checkpoint is outside its case.")
            valid_box(box)
    return cases


def checkpoint_frames(truth, fps):
    checkpoints = {}
    for seconds, box in truth.items():
        checkpoints.setdefault(round(float(seconds) * fps), []).append((float(seconds), box))
    return checkpoints


def analyzed_frame(index, first, step, checkpoints):
    return (index - first) % step == 0 or index in checkpoints


def transformed_box(box, transform, width=960, height=540):
    x1, y1, x2, y2 = box
    corners = np.array(
        [
            [x1 * width, y1 * height, 1],
            [x2 * width, y1 * height, 1],
            [x2 * width, y2 * height, 1],
            [x1 * width, y2 * height, 1],
        ]
    )
    projected = corners @ transform.T
    low = np.clip(projected.min(axis=0) / [width, height], 0, 1)
    high = np.clip(projected.max(axis=0) / [width, height], 0, 1)
    return [*low, *high]


def draw_result(image, result, name, seconds, truth=None):
    image = image.copy()
    height, width = image.shape[:2]
    if truth:
        x1, y1, x2, y2 = truth
        cv2.rectangle(
            image,
            (round(x1 * width), round(y1 * height)),
            (round(x2 * width), round(y2 * height)),
            (0, 210, 255),
            2,
        )
    if result.get("box"):
        x1, y1, x2, y2 = result["box"]
        cv2.rectangle(
            image,
            (round(x1 * width), round(y1 * height)),
            (round(x2 * width), round(y2 * height)),
            (255, 230, 20),
            2,
        )
    cv2.rectangle(image, (0, 0), (width, 30), (15, 15, 15), -1)
    cv2.putText(
        image,
        f"{name} | {seconds:.1f}s | {result['status']}",
        (8, 22),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (255, 255, 255),
        1,
    )
    return image


def status_events(rows, role):
    events = []
    for row in rows:
        status = row[role]["status"]
        if not events or events[-1]["status"] != status:
            events.append({"time": row["time"], "status": status})
    return events


def run_case(engine, video, fps, case, output, analysis_fps=15, target_mode="same-video"):
    if target_mode not in ("same-video", "transformed"):
        raise ValueError("Unknown Target video mode.")
    first = round(case["start"] * fps)
    last = min(round(case["end"] * fps), int(video.get(cv2.CAP_PROP_FRAME_COUNT)) - 1)
    step = max(1, round(fps / analysis_fps))
    checkpoints = checkpoint_frames(case.get("truth", {}), fps)
    video.set(cv2.CAP_PROP_POS_FRAMES, first)
    ok, initial = video.read()
    if not ok:
        raise ValueError("Cannot decode the initial case frame.")
    initial = cv2.resize(initial, (960, 540))
    selected = engine.select(initial, None, case["box"])
    token = selected["token"]
    native = output / (case["name"] + ".native.mp4")
    writer = cv2.VideoWriter(str(native), cv2.VideoWriter_fourcc(*"mp4v"), fps / step, (1920, 540))
    if not writer.isOpened():
        engine.clear(token)
        raise RuntimeError("Video writer unavailable.")
    rows, timing, measured = [], [], []
    transform = None
    if target_mode == "transformed":
        transform = cv2.getRotationMatrix2D((480, 270), 3, 0.98)
        transform[:, 2] += [16, -4]
    snapshots = []
    try:
        for index in range(first, last + 1):
            if index == first:
                image = initial
            else:
                ok, frame = video.read()
                if not ok:
                    raise ValueError(f"Cannot decode video frame {index}.")
                image = cv2.resize(frame, (960, 540))
            if index != last and not analyzed_frame(index, first, step, checkpoints):
                continue
            target = (
                image.copy() if transform is None else cv2.warpAffine(image, transform, (960, 540))
            )
            before = time.monotonic()
            scene_result = engine.track(token, image)
            target_result = engine.match(token, target)
            timing.append((time.monotonic() - before) * 1000)
            annotations = checkpoints.get(index, [])
            truth = annotations[0][1] if annotations else None
            for seconds, annotation in annotations:
                measured.append(
                    {
                        "time": seconds,
                        "frameTime": index / fps,
                        "sceneIoU": overlap(scene_result.get("box"), annotation),
                        "targetIoU": overlap(
                            target_result.get("box"),
                            annotation
                            if transform is None
                            else transformed_box(annotation, transform),
                        ),
                    }
                )
            rows.append({"time": index / fps, "scene": scene_result, "target": target_result})
            display = np.concatenate(
                [
                    draw_result(image, scene_result, "Scene", index / fps, truth),
                    draw_result(
                        target,
                        target_result,
                        "Target (same video)" if transform is None else "Target (transformed copy)",
                        index / fps,
                        truth
                        if transform is None
                        else transformed_box(truth, transform)
                        if truth
                        else None,
                    ),
                ],
                axis=1,
            )
            writer.write(display)
            if truth is not None:
                snapshots.append(cv2.resize(display, (960, 270)))
    finally:
        writer.release()
        engine.clear(token)
    clip = output / (case["name"] + ".mp4")
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(native),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(clip),
        ],
        check=True,
    )
    target_events = status_events(rows, "target")
    first_match = next((row for row in rows if row["target"]["status"] == "matched"), None)
    summary = {
        "case": case["name"],
        "firstAnalyzedTime": rows[0]["time"],
        "lastAnalyzedTime": rows[-1]["time"],
        "targetMode": target_mode,
        "targetFirstAcquiredTime": first_match["time"] if first_match else None,
        "targetInitialAcquisition": first_match["target"] if first_match else None,
        "targetStatusEvents": target_events,
        "sceneStatusEvents": status_events(rows, "scene"),
        "analyzedFrames": len(rows),
        "analysisFps": fps / step,
        "sceneVisibleFraction": sum(row["scene"]["status"] == "matched" for row in rows)
        / len(rows),
        "targetVisibleFraction": sum(row["target"]["status"] == "matched" for row in rows)
        / len(rows),
        "checkpointCount": len(measured),
        "sceneCheckpointMeanIoU": statistics.mean(row["sceneIoU"] for row in measured)
        if measured
        else None,
        "sceneCheckpointSuccessFraction": sum(row["sceneIoU"] >= 0.5 for row in measured)
        / len(measured)
        if measured
        else None,
        "targetCheckpointMeanIoU": statistics.mean(row["targetIoU"] for row in measured)
        if measured
        else None,
        "targetCheckpointSuccessFraction": sum(row["targetIoU"] >= 0.5 for row in measured)
        / len(measured)
        if measured
        else None,
        "medianPairAnalysisMs": statistics.median(timing),
        "p95PairAnalysisMs": float(np.percentile(timing, 95)),
        "checkpoints": measured,
        "targetTest": (
            "Identical video pixels; Target independently searches from the Scene selection"
            if transform is None
            else "3 degree rotated/scaled/translated copy; not an independent real viewpoint"
        ),
    }
    (output / (case["name"] + ".json")).write_text(
        json.dumps({"summary": summary, "frames": rows}, indent=2)
    )
    if snapshots:
        columns = 2
        tile = np.zeros((270 * math.ceil(len(snapshots) / columns), 960 * columns, 3), np.uint8)
        for i, snapshot in enumerate(snapshots):
            tile[
                (i // columns) * 270 : (i // columns + 1) * 270,
                (i % columns) * 960 : (i % columns + 1) * 960,
            ] = snapshot
        cv2.imwrite(str(output / (case["name"] + "-checkpoints.jpg")), tile)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--analysis-fps", type=float, default=15)
    parser.add_argument(
        "--target-mode", choices=("same-video", "transformed"), default="same-video"
    )
    args = parser.parse_args()
    if not math.isfinite(args.analysis_fps) or not 1 <= args.analysis_fps <= 60:
        raise ValueError("Analysis rate must be between 1 and 60 frames per second.")
    video = cv2.VideoCapture(str(args.video))
    try:
        fps, count = video.get(cv2.CAP_PROP_FPS), video.get(cv2.CAP_PROP_FRAME_COUNT)
        if not video.isOpened() or not math.isfinite(fps) or fps <= 0 or count < 1:
            raise ValueError("Cannot read the supplied video.")
        cases = validate_cases(json.loads(args.cases.read_text()), count / fps)
        args.output.mkdir(parents=True, exist_ok=False)
        engine = VisionEngine()
        summaries = []
        for case in cases:
            summary = run_case(
                engine, video, fps, case, args.output, args.analysis_fps, args.target_mode
            )
            summaries.append(summary)
            print(json.dumps(summary), flush=True)
        (args.output / "summary.json").write_text(json.dumps(summaries, indent=2))
    finally:
        video.release()


if __name__ == "__main__":
    main()
