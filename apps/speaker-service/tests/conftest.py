import pytest


@pytest.fixture
def offset_video(tmp_path):
    import subprocess

    path = tmp_path / "offset.mov"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=64x64:rate=10:duration=0.6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000:duration=0.4",
            "-filter_complex",
            "[1:a]asetpts=PTS+0.2/TB[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-c:a",
            "pcm_s16le",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path
