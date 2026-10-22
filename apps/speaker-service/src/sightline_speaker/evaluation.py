"""Independent two-speaker GRID example mixture, for evaluation only.

Official examples are research-use media and remain in ignored local data.
The inference boundary receives the mixture MOV, never either clean stem.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from .assets import sha256_file
from .benchmark import benchmark, si_sdr
from .media import decode_media, run_media_command
from .model import SAMPLE_RATE

SOURCES = {
    "male": "https://spandh.dcs.shef.ac.uk/gridcorpus/examples/id2_vcd_swwp2s.mpg",
    "female": "https://spandh.dcs.shef.ac.uk/gridcorpus/examples/id23_vcd_priazn.mpg",
}


def prepare_mixture(directory: Path) -> tuple[Path, list[Path]]:
    sources = directory / "sources"
    stems = directory / "ground-truth"
    stems.mkdir(parents=True, exist_ok=True)
    length = 3 * SAMPLE_RATE
    signals, paths = [], []
    for name in SOURCES:
        source = sources / f"grid-{name}.mpg"
        if not source.is_file():
            raise FileNotFoundError(f"Download the official example first: {SOURCES[name]}")
        raw = run_media_command(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(source),
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-f",
                "f32le",
                "pipe:1",
            ]
        )
        pcm = np.frombuffer(raw, dtype="<f4").copy()[:length]
        pcm = np.pad(pcm, (0, length - pcm.size))
        pcm *= 0.1 / max(float(np.sqrt(np.mean(pcm**2))), 1e-8)
        signals.append(pcm)
        path = stems / f"{name}.wav"
        sf.write(path, pcm, SAMPLE_RATE, subtype="FLOAT")
        paths.append(path)
    mixture_wav = directory / "mixed.wav"
    sf.write(mixture_wav, signals[0] + signals[1], SAMPLE_RATE, subtype="FLOAT")
    mixture = directory / "grid-overlap-degraded.mov"
    run_media_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(sources / "grid-male.mpg"),
            "-i",
            str(sources / "grid-female.mpg"),
            "-i",
            str(mixture_wav),
            "-filter_complex",
            "[0:v]fps=15,scale=160:128,tpad=stop_mode=clone:stop_duration=1[a];"
            "[1:v]fps=15,scale=160:128,tpad=stop_mode=clone:stop_duration=1[b];"
            "[a][b]hstack,pad=320:180:0:26[v]",
            "-map",
            "[v]",
            "-map",
            "2:a",
            "-t",
            "3",
            "-c:v",
            "libx264",
            "-crf",
            "34",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "pcm_s16le",
            str(mixture),
        ]
    )
    provenance = {
        "sources": {
            name: {"url": url, "sha256": sha256_file(sources / f"grid-{name}.mpg")}
            for name, url in SOURCES.items()
        },
        "mixture_sha256": sha256_file(mixture),
        "duration": 3,
        "equal_rms": 0.1,
        "video": "320x180, 15fps, H264 CRF34",
        "ground_truth_inference_access": False,
    }
    (directory / "provenance.json").write_text(json.dumps(provenance, indent=2))
    return mixture, paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("data/evaluation"))
    parser.add_argument("--assets", type=Path, default=Path("data/assets"))
    args = parser.parse_args()
    mixture, stems = prepare_mixture(args.directory)
    output = args.directory / "results"
    report = benchmark(
        mixture, args.assets, output, regions=[(0, 0.1, 0.5, 0.8), (0.5, 0.1, 0.5, 0.8)]
    )
    mixed = decode_media(mixture).audio
    scores = []
    for stem, result in zip(stems, report["targets"], strict=True):
        target, _ = sf.read(stem)
        estimate, _ = sf.read(result["audio"])
        length = min(len(target), len(mixed), len(estimate))
        baseline = si_sdr(target[:length], mixed[:length])
        focused = si_sdr(target[:length], estimate[:length])
        scores.append(
            {
                "stem": stem.name,
                "mixture_si_sdr_db": baseline,
                "focused_si_sdr_db": focused,
                "improvement_db": focused - baseline,
            }
        )
    (output / "quality.json").write_text(
        json.dumps(
            {
                "scores": scores,
                "limitations": "Two short GRID examples; not a general quality claim.",
            },
            indent=2,
        )
    )
    print(json.dumps(scores, indent=2))


if __name__ == "__main__":
    main()
