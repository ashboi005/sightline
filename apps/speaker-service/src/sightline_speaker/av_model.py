"""Explicit, verified local AV-MossFormer2 target extraction."""

import json
from importlib.resources import files
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch
import yaml

from .assets import (
    AV_ASSET_HASHES,
    AV_SOURCE_COMMIT,
    AV_WEIGHT_REVISION,
    load_checkpoint,
    verify_file,
)
from .model import validate_inputs

FACE_SIZE = 112


def _namespace(config: dict) -> SimpleNamespace:
    return SimpleNamespace(
        **{
            key: _namespace(value) if isinstance(value, dict) else value
            for key, value in config.items()
        }
    )


class AvMossFormerSeparator:
    engine_key = "av-mossformer2"
    engine = "AV-MossFormer2-TSE-16K"
    clip_window_duration = 3.0
    clip_stride = 1.8

    def __init__(self, network: torch.nn.Module, device: str):
        self.device = device
        self.audio_device = self.visual_device = device
        self.network = network.to(device).eval()
        self.parameter_count = sum(parameter.numel() for parameter in network.parameters())

    @classmethod
    def load(cls, asset_dir: Path, device: str = "cpu") -> "AvMossFormerSeparator":
        manifest_path = asset_dir / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError("AV-MossFormer2 assets are missing; run explicit asset setup")
        manifest = json.loads(manifest_path.read_text())
        if (
            manifest.get("engine") != cls.engine
            or manifest.get("files") != AV_ASSET_HASHES
            or manifest.get("source_commit") != AV_SOURCE_COMMIT
            or manifest.get("weight_revision") != AV_WEIGHT_REVISION
        ):
            raise ValueError("AV-MossFormer2 asset manifest does not match the pinned release")
        for name, checksum in AV_ASSET_HASHES.items():
            verify_file(asset_dir / name, checksum)
        if device not in {"cpu", "mps", "auto"}:
            raise ValueError("Unsupported inference device")
        available = torch.backends.mps.is_available()
        if device == "mps" and not available:
            raise ValueError("MPS is unavailable on this host")
        selected = "mps" if device != "cpu" and available else "cpu"

        from av_mossformer2.av_mossformer2 import av_mossformer2

        torch.set_num_threads(4)
        config = yaml.safe_load(files("av_mossformer2").joinpath("config.yaml").read_text())
        network = av_mossformer2(_namespace(config))
        checkpoint = load_checkpoint(asset_dir / "last_best_checkpoint.pt", mmap=True)
        state = checkpoint.get("model")
        if not isinstance(state, dict) or not all(isinstance(key, str) for key in state):
            raise ValueError("AV-MossFormer2 checkpoint must contain model tensors")
        network.load_state_dict(
            {key.removeprefix("module."): value for key, value in state.items()}, strict=True
        )
        return cls(network, selected)

    def extract(self, mixed_pcm: np.ndarray, prepared_frames: np.ndarray) -> np.ndarray:
        validate_inputs(mixed_pcm, prepared_frames, frame_size=FACE_SIZE)
        peak = float(np.max(np.abs(mixed_pcm)))
        if peak == 0:
            return np.zeros(mixed_pcm.shape, dtype=np.float32)
        audio = np.ascontiguousarray(mixed_pcm / peak, dtype=np.float32)
        frames = np.ascontiguousarray(prepared_frames, dtype=np.float32)
        with torch.inference_mode():
            result = self.network(
                torch.from_numpy(audio)[None].to(self.device),
                torch.from_numpy(frames)[None].to(self.device),
            )
        if result.shape != (1, mixed_pcm.size):
            raise RuntimeError("Model returned invalid audio; focused playback is unavailable")
        output = result[0].cpu().numpy().astype(np.float32) * peak
        if output.shape != mixed_pcm.shape or not np.isfinite(output).all():
            raise RuntimeError("Model returned invalid audio; focused playback is unavailable")
        return output
