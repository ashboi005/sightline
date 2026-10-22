"""Seeded synthetic environmental noise added to the single original mixture."""

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from .assets import sha256_file
from .media import decode_media, run_media_command


def augment(mixed: np.ndarray, seed=20261004) -> np.ndarray:
    if mixed.ndim != 1 or not mixed.size or not np.isfinite(mixed).all():
        raise ValueError("Expected finite original mono mixed PCM")
    rng = np.random.default_rng(seed)
    time = np.arange(mixed.size) / 16000
    noise = rng.normal(0, 0.018, mixed.size)
    noise += 0.012 * np.sin(2 * np.pi * 50 * time) + 0.005 * np.sin(2 * np.pi * 100 * time)
    for start in range(16000, mixed.size, 35200):
        count = min(240, mixed.size - start)
        noise[start : start + count] += rng.normal(0, 0.10, count) * np.exp(-np.arange(count) / 50)
    return np.clip(mixed + noise, -0.98, 0.98).astype(np.float32)


def create_fixture(source: Path, output: Path, seed=20261004):
    media = decode_media(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    pcm = augment(media.audio, seed)
    wav = output.with_suffix(".mixed.wav")
    sf.write(wav, pcm, 16000, subtype="FLOAT")
    run_media_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(source.resolve()),
            "-i",
            str(wav.resolve()),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "pcm_f32le",
            str(output.resolve()),
        ]
    )
    report = {
        "kind": "synthetic hiss, 50/100 Hz hum and brief transients added to one complete mixture",
        "seed": seed,
        "input_sha256": sha256_file(source),
        "output_sha256": sha256_file(output),
        "sample_count": pcm.size,
        "sample_rate": 16000,
        "target_stems_created": False,
        "physical_esp32_validation": False,
    }
    output.with_suffix(".json").write_text(json.dumps(report, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20261004)
    args = parser.parse_args()
    print(json.dumps(create_fixture(args.input, args.output, args.seed), indent=2))


if __name__ == "__main__":
    main()
