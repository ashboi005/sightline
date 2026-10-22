"""Reproducible inference measurements; ground truth never enters the separator."""

import argparse
import json
import platform
import threading
from dataclasses import asdict
from pathlib import Path
from time import perf_counter

import numpy as np
import psutil
import soundfile as sf

from .assets import ASSET_HASHES, sha256_file
from .audio import ExtractionResult, extract_track
from .faces import FaceTrack, manual_track, track_faces
from .media import decode_media, run_media_command
from .model import SAMPLE_RATE, Separator


def si_sdr(target: np.ndarray, estimate: np.ndarray) -> float:
    if target.shape != estimate.shape or target.ndim != 1:
        raise ValueError("Evaluation audio must have equal mono dimensions")
    if not np.isfinite(target).all() or not np.isfinite(estimate).all():
        raise ValueError("Evaluation audio must be finite")
    reference = target.astype(np.float64) - np.mean(target)
    prediction = estimate.astype(np.float64) - np.mean(estimate)
    energy = np.dot(reference, reference)
    if energy < 1e-10:
        raise ValueError("Cannot score a silent target")
    projection = np.dot(reference, prediction) / energy * reference
    residual = prediction - projection
    return float(
        10
        * np.log10((np.dot(projection, projection) + 1e-12) / (np.dot(residual, residual) + 1e-12))
    )


def export_result(source: Path, result: ExtractionResult, directory: Path) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    wav = directory / "focused.wav"
    preview = directory / "preview.mp4"
    sf.write(wav, result.audio, SAMPLE_RATE, subtype="PCM_16")
    run_media_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(source.resolve()),
            "-i",
            str(wav.resolve()),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-c:a",
            "aac",
            "-shortest",
            str(preview.resolve()),
        ]
    )
    return wav.resolve(), preview.resolve()


def save_tracks(tracks: list[FaceTrack], path: Path) -> None:
    records = []
    for track in tracks:
        record = asdict(track)
        for observation in record["observations"]:
            observation["anchors"] = observation["anchors"].tolist()
            observation["mouth"] = observation["mouth"].tolist()
        records.append(record)
    path.write_text(json.dumps(records))


def benchmark(
    source: Path,
    assets: Path,
    output: Path,
    device: str = "auto",
    regions: list[tuple[float, float, float, float]] | None = None,
) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    started = perf_counter()
    process = psutil.Process()
    peak_rss = [process.memory_info().rss]
    stopped = threading.Event()

    def sample_memory():
        while not stopped.wait(0.05):
            peak_rss[0] = max(peak_rss[0], process.memory_info().rss)

    sampler = threading.Thread(target=sample_memory, daemon=True)
    sampler.start()
    try:
        media = decode_media(source)
        decode_time = perf_counter() - started
        tick = perf_counter()
        if regions:
            tracks = [manual_track(media, region) for region in regions]
        else:
            tracks = sorted(track_faces(media), key=lambda t: len(t.observations), reverse=True)
            tracks = tracks[:2] + [manual_track(media, (0.65, 0.08, 0.32, 0.53))]
            tracks.sort(key=lambda t: t.observations[0].box[0])
        analysis_time = perf_counter() - tick
        save_tracks(tracks, output / "tracks.json")
        tick = perf_counter()
        separator = Separator.load(assets, device)
        load_time = perf_counter() - tick
        # Measured warm-up is separate from the clip timing.
        from .faces import mouth_sequence

        tick = perf_counter()
        separator.extract(media.audio[:32000], mouth_sequence(media, tracks[0], 0, 2))
        warmup_time = perf_counter() - tick
        targets = []
        for index, track in enumerate(tracks):
            print(f"Extracting target {index + 1}/{len(tracks)} ({track.id})", flush=True)
            result = extract_track(media, track, separator, lambda: False, lambda _: None)
            wav, preview = export_result(source, result, output / f"target-{index + 1}")
            targets.append(
                {
                    "track_id": track.id,
                    "manual_region": track.manual,
                    "audio": str(wav),
                    "audio_sha256": sha256_file(wav),
                    "preview": str(preview),
                    "elapsed_seconds": result.elapsed_seconds,
                    "real_time_factor": result.elapsed_seconds / media.duration,
                    "window_seconds": result.window_seconds,
                    "window_p50": float(np.median(result.window_seconds)),
                    "window_p95": float(np.percentile(result.window_seconds, 95)),
                    "window_duration": result.window_duration,
                    "stride": result.stride,
                    "gain": result.gain,
                }
            )
            print(
                f"Target {index + 1}: {result.elapsed_seconds:.3f}s for {media.duration:.3f}s",
                flush=True,
            )
        report = {
            "input": {
                "name": source.name,
                "path": str(source.resolve()),
                "sha256": sha256_file(source),
            },
            "hardware": platform.platform(),
            "device": separator.device,
            "engine": separator.engine,
            "parameters": separator.parameter_count,
            "model_hashes": ASSET_HASHES,
            "sample_count": media.audio.size,
            "duration": media.duration,
            "decode_seconds": decode_time,
            "analysis_seconds": analysis_time,
            "load_seconds": load_time,
            "warmup_seconds": warmup_time,
            "peak_process_rss_bytes": peak_rss[0],
            "wall_seconds": perf_counter() - started,
            "targets": targets,
            "limitations": [
                "Reference clip has no clean stems: no SI-SDR claim.",
                "Mouth preprocessing uses our five-point canonical geometry.",
                "Resolution/compression proxy does not reproduce IR spectral response or optics.",
                "Process RSS excludes separately reported Apple GPU allocations.",
            ],
        }
        if separator.visual_device == "mps":
            import torch

            report["mps_current_bytes"] = torch.mps.current_allocated_memory()
            report["mps_driver_bytes"] = torch.mps.driver_allocated_memory()
        (output / "report.json").write_text(json.dumps(report, indent=2))
        return report
    finally:
        stopped.set()
        sampler.join(timeout=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--assets", type=Path, default=Path("data/assets"))
    parser.add_argument("--output", type=Path, default=Path("data/benchmarks/reference"))
    parser.add_argument("--device", choices=["cpu", "mps", "auto"], default="auto")
    args = parser.parse_args()
    benchmark(args.source, args.assets, args.output, args.device)


if __name__ == "__main__":
    main()
