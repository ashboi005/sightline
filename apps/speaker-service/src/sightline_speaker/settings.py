"""Explicit local-service limits and paths."""

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

DEFAULT_ENGINE = "av-mossformer2"


def default_asset_dir(engine: str) -> Path:
    return Path("data/av-assets" if engine == "av-mossformer2" else "data/assets")


def _is_exact_origin(origin: str) -> bool:
    """Local HTTP dev origins or the deployed web app's HTTPS origin; the service stays loopback."""
    parts = urlsplit(origin)
    if parts.path or parts.query or parts.fragment or parts.username or not parts.hostname:
        return False
    if parts.scheme == "http":
        return parts.hostname in {"localhost", "127.0.0.1"} and parts.port is not None
    return parts.scheme == "https"


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path("data/sessions")
    asset_dir: Path | None = None
    device: str = "auto"
    engine: str = DEFAULT_ENGINE
    noise: str = "auto"
    origin: str = "http://localhost:3001"
    port: int = 7799
    max_upload_bytes: int = 120 * 1024 * 1024
    max_data_bytes: int = 1024 * 1024 * 1024
    retention_seconds: float = 1800
    max_queue: int = 2
    max_clips: int = 16
    max_jobs_per_clip: int = 24
    max_duration: float = 120

    def __post_init__(self):
        if self.engine not in {"rtfs", "av-mossformer2"}:
            raise ValueError("Unsupported separation engine")
        if self.asset_dir is None:
            object.__setattr__(self, "asset_dir", default_asset_dir(self.engine))
        if self.noise not in {"auto", "rnnoise", "off"}:
            raise ValueError("Unsupported noise mode")
        if self.device not in {"cpu", "mps", "auto"}:
            raise ValueError("Unsupported inference device")
        if (
            min(
                self.max_upload_bytes,
                self.max_data_bytes,
                self.retention_seconds,
                self.max_queue,
                self.max_duration,
            )
            <= 0
        ):
            raise ValueError("Service limits must be positive")
        if not _is_exact_origin(self.origin):
            raise ValueError(
                "Frontend origin must be an exact origin: http://localhost:<port>, "
                "http://127.0.0.1:<port> or https://<host>[:port] (no path)"
            )
