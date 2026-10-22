"""The browser/service contract, with no filesystem paths in requests."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .faces import Box, validate_region


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ErrorView(DTO):
    code: str
    message: str


class TrackObservationView(DTO):
    timestamp: float
    box: Box


class TrackView(DTO):
    id: str
    manual: bool
    observations: list[TrackObservationView]


class MediaView(DTO):
    width: int
    height: int
    duration: float
    sample_count: int
    frame_count: int


class ClipView(DTO):
    id: str
    status: Literal["uploading", "queued", "analysing", "ready", "failed", "cancelled"]
    media: MediaView | None = None
    tracks: list[TrackView] = Field(default_factory=list)
    error: ErrorView | None = None


class ExtractionRequest(DTO):
    target_id: Annotated[str, Field(min_length=1, max_length=64)]
    generation: Annotated[int, Field(ge=0, strict=True)]


class RegionRequest(DTO):
    box: Box

    @field_validator("box")
    @classmethod
    def valid_box(cls, value):
        validate_region(value)
        return value


class JobView(DTO):
    id: str
    clip_id: str
    target_id: str
    generation: int
    status: Literal["queued", "running", "done", "cancelled", "failed"]
    progress: Annotated[float, Field(ge=0, le=1)]
    error: ErrorView | None = None
    audio_url: str | None = None
    preview_url: str | None = None
    elapsed_seconds: float | None = None
    window_p95_seconds: float | None = None
    device: str | None = None


class HealthView(DTO):
    ready: bool
    model_state: Literal["loading", "ready", "unready"]
    engine: str = "RTFS-Net-4-LRS2"
    device: str | None = None
    error: ErrorView | None = None
    clip: bool = True
    live: bool = False
    streaming_ready: bool = False
    streaming_error: str | None = None
    noise_processor: str | None = None
    max_upload_bytes: int
    max_duration: float
    queued: int
    live_analysis_mode: Literal["available"] = "available"
    live_minimum_seconds: float = 0.12
    live_history_seconds: float = 0.4
    window_seconds: float = 2
    stride_seconds: float = 1
