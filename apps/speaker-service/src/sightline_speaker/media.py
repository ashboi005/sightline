"""Bounded local media decode using source presentation timestamps."""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .model import SAMPLE_RATE


@dataclass(frozen=True)
class MediaLimits:
    max_duration: float = 120.0
    max_dimension: int = 4096
    max_frames: int = 3600
    max_decoded_pixels: int = 500_000_000
    decode_width: int = 640


@dataclass
class DecodedMedia:
    path: Path
    audio: np.ndarray
    frames: list[np.ndarray]
    timestamps: np.ndarray
    width: int
    height: int
    duration: float
    sample_rate: int = SAMPLE_RATE


def validate_media_info(duration: float, width: int, height: int, limits: MediaLimits) -> None:
    if not np.isfinite(duration) or not 0 < duration <= limits.max_duration:
        raise ValueError(f"Media duration must be at most {limits.max_duration:g} seconds")
    if not 0 < width <= limits.max_dimension or not 0 < height <= limits.max_dimension:
        raise ValueError("Unsupported video dimensions")


def nearest_frame_indices(timestamps: np.ndarray, desired: np.ndarray) -> np.ndarray:
    if (
        timestamps.ndim != 1
        or not timestamps.size
        or not np.isfinite(timestamps).all()
        or np.any(np.diff(timestamps) <= 0)
    ):
        raise ValueError("Video timestamps must be finite and strictly increasing")
    if not np.isfinite(desired).all():
        raise ValueError("Requested timestamps must be finite")
    right = np.searchsorted(timestamps, desired).clip(0, len(timestamps) - 1)
    left = (right - 1).clip(0, len(timestamps) - 1)
    return np.where(
        np.abs(timestamps[left] - desired) < np.abs(timestamps[right] - desired), left, right
    )


def align_audio(audio: np.ndarray, start_offset: float, sample_rate: int) -> np.ndarray:
    if not np.isfinite(start_offset) or start_offset < 0:
        raise ValueError("Invalid audio timestamp offset")
    return np.pad(audio, (round(start_offset * sample_rate), 0))


def run_media_command(command: list[str], timeout: float = 90) -> bytes:
    try:
        result = subprocess.run(command, capture_output=True, check=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise RuntimeError("FFmpeg and FFprobe must be installed") from exc
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise ValueError("The local media could not be decoded within its limits") from exc
    return result.stdout


def audio_timeline_start(path: Path, sample_rate: int, limits: MediaLimits) -> float:
    """Reject source gaps/drift instead of flattening them into contiguous PCM."""
    if sample_rate <= 0:
        raise ValueError("Audio synchronization requires a valid source sample rate")
    maximum = 200_000
    probe = json.loads(
        run_media_command(
            [
                "ffprobe",
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-select_streams",
                "a:0",
                "-read_intervals",
                f"%+#{maximum}",
                "-show_frames",
                "-show_entries",
                "frame=best_effort_timestamp_time,nb_samples",
                "-of",
                "json",
                str(path.resolve()),
            ]
        )
    )
    frames = probe.get("frames", [])
    if not frames or len(frames) >= maximum:
        raise ValueError("Audio synchronization frame count exceeds the decode limit")
    try:
        timestamps = np.array([float(frame["best_effort_timestamp_time"]) for frame in frames])
        counts = np.array([int(frame["nb_samples"]) for frame in frames])
    except (KeyError, ValueError) as exc:
        raise ValueError("Audio synchronization timestamps are unavailable") from exc
    if not np.isfinite(timestamps).all() or np.any(counts <= 0):
        raise ValueError("Audio synchronization timestamps are invalid")
    expected = np.r_[0, np.cumsum(counts[:-1])] / sample_rate
    # Container timestamp quantization can differ by a millisecond; cumulative
    # checking prevents small per-packet errors from concealing sustained drift.
    if np.any(np.abs(timestamps - timestamps[0] - expected) > 0.005):
        raise ValueError("Audio synchronization discontinuity; use a continuous mixed recording")
    if counts.sum() / sample_rate > limits.max_duration + 0.1:
        raise ValueError("Decoded audio exceeds duration limits")
    return float(timestamps[0])


def decode_media(path: Path, limits: MediaLimits | None = None) -> DecodedMedia:
    limits = limits or MediaLimits()
    probe = json.loads(
        run_media_command(
            [
                "ffprobe",
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path.resolve()),
            ]
        )
    )
    video = next((stream for stream in probe["streams"] if stream["codec_type"] == "video"), None)
    audio = next((stream for stream in probe["streams"] if stream["codec_type"] == "audio"), None)
    if video is None or audio is None:
        raise ValueError("Input needs both a video stream and mixed audio")
    formats = set(probe["format"]["format_name"].split(","))
    if not formats.intersection({"mov", "mp4", "matroska", "webm", "avi"}):
        raise ValueError("Use an MP4, WebM, MOV, MKV, or AVI video")
    duration = float(probe["format"].get("duration", 0))
    validate_media_info(duration, int(video["width"]), int(video["height"]), limits)
    frame_probe = json.loads(
        run_media_command(
            [
                "ffprobe",
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-select_streams",
                "v:0",
                "-read_intervals",
                f"%+{limits.max_duration + 1}",
                "-show_frames",
                "-show_entries",
                "frame=best_effort_timestamp_time",
                "-of",
                "json",
                str(path.resolve()),
            ]
        )
    )
    times = np.array(
        [float(frame["best_effort_timestamp_time"]) for frame in frame_probe["frames"]]
    )
    if not times.size or times.size > limits.max_frames:
        raise ValueError("Video frame count exceeds the decode limit")
    audio_start = audio_timeline_start(path, int(audio.get("sample_rate", 0)), limits)
    origin = min(times[0], audio_start)
    times = times - origin
    nearest_frame_indices(times, times[:1])
    frames = []
    pixels = 0
    capture = cv2.VideoCapture(str(path.resolve()))
    try:
        while True:
            ready, frame = capture.read()
            if not ready:
                break
            if len(frames) >= limits.max_frames:
                raise ValueError("Video frame count exceeds the decode limit")
            scale = min(1.0, limits.decode_width / max(frame.shape[:2]))
            if scale < 1:
                frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            pixels += frame.shape[0] * frame.shape[1]
            if pixels > limits.max_decoded_pixels:
                raise ValueError("Decoded pixels exceed memory budget; shorten the video")
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        capture.release()
    if len(frames) != len(times):
        raise ValueError("Video decode and presentation timestamps disagree")
    raw_audio = run_media_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-xerror",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(path.resolve()),
            "-map",
            "0:a:0",
            "-t",
            str(limits.max_duration + 1),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ]
    )
    pcm = align_audio(
        np.frombuffer(raw_audio, dtype="<f4").copy(), audio_start - origin, SAMPLE_RATE
    )
    if pcm.size > round((limits.max_duration + 0.1) * SAMPLE_RATE) or not np.isfinite(pcm).all():
        raise ValueError("Decoded audio exceeds duration limits or contains invalid samples")
    height, width = frames[0].shape[:2]
    return DecodedMedia(
        path, pcm, frames, times, width, height, max(duration, len(pcm) / SAMPLE_RATE)
    )
