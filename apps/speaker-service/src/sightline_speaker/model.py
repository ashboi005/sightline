"""The pretrained single-target inference boundary."""

import json
from pathlib import Path
from typing import Protocol

import numpy as np
import torch
import yaml

from .assets import ASSET_HASHES, load_checkpoint, verify_file

SAMPLE_RATE = 16000
VIDEO_FPS = 25
MOUTH_SIZE = 88


def validate_inputs(audio: np.ndarray, frames: np.ndarray, *, frame_size: int = MOUTH_SIZE) -> None:
    if audio.ndim != 1 or not 1600 <= audio.size <= SAMPLE_RATE * 8:
        raise ValueError("audio must be a mono 0.1–8 second PCM vector")
    if not np.isfinite(audio).all():
        raise ValueError("audio contains nonfinite samples")
    expected_frames = round(audio.size / SAMPLE_RATE * VIDEO_FPS)
    if frames.shape != (expected_frames, frame_size, frame_size):
        raise ValueError("video frame dimensions or timestamps do not match audio")
    if not np.isfinite(frames).all():
        raise ValueError("video frames contain nonfinite samples")
    if (
        np.max(np.abs(audio)) > np.finfo(np.float32).max
        or np.max(np.abs(frames)) > np.finfo(np.float32).max
    ):
        raise ValueError("Model inputs must be representable as finite float32 samples")


class TargetSeparator(Protocol):
    engine: str
    engine_key: str
    device: str
    parameter_count: int
    clip_window_duration: float
    clip_stride: float

    def extract(self, mixed_pcm: np.ndarray, prepared_frames: np.ndarray) -> np.ndarray: ...


class Separator:
    engine_key = "rtfs"
    clip_window_duration = 2.0
    clip_stride = 1.0

    def __init__(
        self, audio_model: torch.nn.Module, video_model: torch.nn.Module, visual_device: str
    ):
        self.audio_device = "cpu"
        self.visual_device = visual_device
        self.audio_model = audio_model.to(self.audio_device)
        self.video_model = video_model.to(self.visual_device)
        self.audio_model.eval()
        self.video_model.eval()
        self.device = "cpu" if visual_device == "cpu" else "mps-video/cpu-audio"
        self.engine = "RTFS-Net-4-LRS2"
        self.parameter_count = sum(
            parameter.numel()
            for model in (audio_model, video_model)
            for parameter in model.parameters()
        )

    @classmethod
    def load(cls, asset_dir: Path, device: str = "cpu") -> "Separator":
        manifest_path = asset_dir / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError(
                "Model assets are missing; run the explicit asset setup command"
            )
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("engine") != "RTFS-Net-4-LRS2" or manifest.get("files") != ASSET_HASHES:
            raise ValueError("Model asset manifest does not match the pinned checkpoint release")
        for name, checksum in ASSET_HASHES.items():
            if Path(name).name != name:
                raise ValueError("Invalid checkpoint asset path")
            verify_file(asset_dir / name, checksum)
        if device not in {"cpu", "mps", "auto"}:
            raise ValueError("Unsupported inference device")
        if device == "mps" and not torch.backends.mps.is_available():
            raise ValueError("MPS is unavailable on this host")

        from rtfs_net.models import AVNet
        from rtfs_net.models.videomodels import FRCNNVideoModel

        torch.set_num_threads(4)
        config = yaml.safe_load((asset_dir / "config.yaml").read_text())
        audio_model = AVNet(**config["audionet"], print_macs=False)
        state = load_checkpoint(asset_dir / "separator.pth")["state_dict"]
        audio_model.load_state_dict(state, strict=True)
        video_model = FRCNNVideoModel(pretrain=None, print_macs=False)
        visual_state = load_checkpoint(asset_dir / "frcnn_128_512.backbone.pth.tar")[
            "model_state_dict"
        ]
        visual_state = {
            key: value for key, value in visual_state.items() if not key.startswith("tcn")
        }
        video_model.load_state_dict(visual_state, strict=True)
        visual_device = "mps" if device != "cpu" and torch.backends.mps.is_available() else "cpu"
        return cls(audio_model, video_model, visual_device)

    def extract(self, mixed_pcm: np.ndarray, mouth_frames: np.ndarray) -> np.ndarray:
        validate_inputs(mixed_pcm, mouth_frames)
        audio = torch.from_numpy(np.ascontiguousarray(mixed_pcm, dtype=np.float32))[None]
        video = torch.from_numpy(np.ascontiguousarray(mouth_frames, dtype=np.float32))[None, None]
        with torch.inference_mode():
            embedding = self.video_model(video.to(self.visual_device))
            result = self.audio_model(audio.to(self.audio_device), embedding.to(self.audio_device))
        output = result[0, 0].cpu().numpy().astype(np.float32)
        if output.shape != mixed_pcm.shape or not np.isfinite(output).all():
            raise RuntimeError("Model returned invalid audio; focused playback is unavailable")
        return output


def load_separator(asset_dir: Path, device: str = "cpu", engine: str = "rtfs") -> TargetSeparator:
    """Select only explicit supported local engines; loading never downloads weights."""
    if engine == "rtfs":
        return Separator.load(asset_dir, device)
    if engine == "av-mossformer2":
        from .av_model import AvMossFormerSeparator

        return AvMossFormerSeparator.load(asset_dir, device)
    raise ValueError("Unsupported separation engine")
