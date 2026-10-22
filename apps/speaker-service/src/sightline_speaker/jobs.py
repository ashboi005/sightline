"""One worker, bounded queue, opaque ownership and cancellable publication."""

import fcntl
import logging
import queue
import re
import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic
from uuid import uuid4

import numpy as np

from .audio import ExtractionCancelled, extract_track
from .benchmark import export_result
from .faces import Box, FaceTrack, manual_track, track_faces, track_in_region
from .media import MediaLimits, decode_media
from .model import TargetSeparator, load_separator
from .schemas import (
    ClipView,
    ErrorView,
    HealthView,
    JobView,
    MediaView,
    TrackObservationView,
    TrackView,
)
from .settings import Settings

logger = logging.getLogger(__name__)


class ServiceError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def view(self) -> ErrorView:
        return ErrorView(code=self.code, message=self.message)


@dataclass
class Clip:
    id: str
    path: Path
    touched: float
    status: str = "uploading"
    tracks: list[FaceTrack] = field(default_factory=list)
    media: MediaView | None = None
    error: ErrorView | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    busy: bool = False


@dataclass
class Job:
    id: str
    clip_id: str
    target_id: str
    generation: int
    touched: float
    status: str = "queued"
    progress: float = 0
    error: ErrorView | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    audio: Path | None = None
    preview: Path | None = None
    elapsed_seconds: float | None = None
    window_p95_seconds: float | None = None
    device: str | None = None


class Store:
    def __init__(
        self,
        settings: Settings,
        start_worker: bool = True,
        load_model: bool = True,
        clock: Callable[[], float] = monotonic,
    ):
        self.settings, self.clock = settings, clock
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.lease = (self.settings.data_dir / ".service.lock").open("a")
        try:
            fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.lease.close()
            raise ServiceError(
                "data_in_use", "Session data directory is already in use", 409
            ) from exc
        # No persisted session can be resumed after process restart. Only opaque
        # directories in this exclusively owned session namespace are removed.
        for path in self.settings.data_dir.iterdir():
            if re.fullmatch(r"[a-f0-9]{32}", path.name) and path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
        self.lock = threading.RLock()
        self.live_lock = threading.Lock()
        self.queue: queue.Queue[Callable[[], None]] = queue.Queue(maxsize=settings.max_queue)
        self.reserved_bytes = 0
        self.clips: dict[str, Clip] = {}
        self.jobs: dict[str, Job] = {}
        self.separator: TargetSeparator | None = None
        self.model_state = "loading" if load_model and start_worker else "unready"
        self.streaming_ready = False
        self.streaming_error = None
        self.warm_timings = []
        self.worker_busy = False
        self.model_error: ErrorView | None = None
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self._worker, args=(load_model,), daemon=True)
        if start_worker:
            self.thread.start()

    def _worker(self, load_model: bool):
        try:
            self._run_worker(load_model)
        finally:
            self.stopping.set()
            self._dispose_sessions()

    def _run_worker(self, load_model: bool):
        if load_model:
            try:
                self.separator = load_separator(
                    self.settings.asset_dir, self.settings.device, self.settings.engine
                )
                self.model_state = "ready"
                self._warm_streaming()
            except Exception as exc:
                logger.exception("Model setup failed")
                self.model_state = "unready"
                self.model_error = ErrorView(code="model_unready", message=str(exc))
        while not self.stopping.is_set():
            try:
                task = self.queue.get(timeout=1)
            except queue.Empty:
                self.cleanup()
                continue
            try:
                self.worker_busy = True
                task()
            except Exception:
                logger.exception("Worker task failed unexpectedly")
            finally:
                self.worker_busy = False
                self.queue.task_done()
                self.cleanup()

    def _warm_streaming(self):
        from time import perf_counter

        from .available_buffer import MINIMUM_SAMPLES, WARM_INPUT_SHAPES
        from .noise import noise_factory

        try:
            noise = noise_factory(self.settings.noise)()
            noise.close()
            width = 112 if self.settings.engine == "av-mossformer2" else 88
            # Precompile common model shapes before accepting live input.
            # Padding to a warm shape never waits for future microphone samples.
            for size in WARM_INPUT_SHAPES:
                audio = (0.02 * np.sin(np.arange(size) * 0.13)).astype(np.float32)
                frames = np.full((size // 640, width, width), 0.1, np.float32)
                repetitions = 4 if size == MINIMUM_SAMPLES else 1
                for iteration in range(repetitions):
                    begin = perf_counter()
                    self.separator.extract(audio, frames)
                    if size == MINIMUM_SAMPLES and iteration:
                        self.warm_timings.append(perf_counter() - begin)
                if getattr(self.separator, "device", None) == "mps":
                    import torch

                    torch.mps.empty_cache()
            self.streaming_ready = True
        except Exception as exc:
            self.streaming_error = str(exc)
            logger.exception("Streaming warm-up failed; file extraction remains available")

    def close(self):
        self.stopping.set()
        with self.lock:
            for clip in self.clips.values():
                clip.cancel.set()
            for job in self.jobs.values():
                job.cancel.set()
        if self.thread.is_alive():
            self.thread.join(timeout=10)
        if not self.thread.is_alive():
            self._dispose_sessions()

    def _dispose_sessions(self):
        with self.lock:
            for clip in self.clips.values():
                shutil.rmtree(clip.path.parent, ignore_errors=True)
            self.clips.clear()
            self.jobs.clear()
            if not self.lease.closed:
                fcntl.flock(self.lease, fcntl.LOCK_UN)
                self.lease.close()

    def submit(self, task: Callable[[], None], *, live=False):
        reserved = not live
        if reserved and not self.live_lock.acquire(blocking=False):
            raise ServiceError("live_busy", "The live listener owns the processing worker", 409)
        try:
            if self.stopping.is_set():
                raise ServiceError("service_stopped", "The local service is stopping", 503)
            try:
                self.queue.put_nowait(task)
            except queue.Full as exc:
                raise ServiceError(
                    "queue_full", "The processing queue is full; retry after a job finishes", 429
                ) from exc
        finally:
            if reserved:
                self.live_lock.release()

    def ensure_capacity(self, additional: int):
        used = sum(
            path.stat().st_size for path in self.settings.data_dir.rglob("*") if path.is_file()
        )
        if used + self.reserved_bytes + additional > self.settings.max_data_bytes:
            raise ServiceError(
                "storage_full", "Local session storage is full; remove a clip and retry", 507
            )

    def reserve(self, amount: int):
        with self.lock:
            self.ensure_capacity(amount)
            self.reserved_bytes += amount

    def release(self, amount: int):
        with self.lock:
            self.reserved_bytes -= amount

    def create_clip(self, filename: str) -> Clip:
        with self.lock:
            self.ensure_capacity(0)
            if len(self.clips) >= self.settings.max_clips:
                raise ServiceError("clip_limit", "Session clip limit reached; remove a clip", 429)
            identity = uuid4().hex
            directory = self.settings.data_dir / identity
            directory.mkdir()
            clip = Clip(
                identity, directory / ("input" + Path(filename).suffix.lower()), self.clock()
            )
            self.clips[identity] = clip
            return clip

    def _clip(self, identity: str) -> Clip:
        clip = self.clips.get(identity)
        if clip is None or clip.cancel.is_set():
            raise ServiceError("not_found", "Unknown clip", 404)
        clip.touched = self.clock()
        return clip

    def _job(self, identity: str) -> Job:
        job = self.jobs.get(identity)
        if job is None:
            raise ServiceError("not_found", "Unknown job", 404)
        job.touched = self.clock()
        if job.clip_id in self.clips:
            self.clips[job.clip_id].touched = self.clock()
        return job

    def clip_view(self, identity: str) -> ClipView:
        with self.lock:
            clip = self._clip(identity)
            return ClipView(
                id=clip.id,
                status=clip.status,
                media=clip.media,
                error=clip.error,
                tracks=[
                    TrackView(
                        id=t.id,
                        manual=t.manual,
                        observations=[
                            TrackObservationView(timestamp=o.timestamp, box=o.box)
                            for o in t.observations
                        ],
                    )
                    for t in clip.tracks
                ],
            )

    def job_view(self, identity: str) -> JobView:
        with self.lock:
            job = self._job(identity)
            complete = job.status == "done" and not job.cancel.is_set()
            return JobView(
                id=job.id,
                clip_id=job.clip_id,
                target_id=job.target_id,
                generation=job.generation,
                status=job.status,
                progress=job.progress,
                error=job.error,
                audio_url=f"/jobs/{job.id}/audio" if complete else None,
                preview_url=f"/jobs/{job.id}/preview" if complete else None,
                elapsed_seconds=job.elapsed_seconds,
                window_p95_seconds=job.window_p95_seconds,
                device=job.device,
            )

    def health(self) -> HealthView:
        from .noise import noise_factory
        from .stream_profile import profile_for

        profile = profile_for(self.settings.engine)
        return HealthView(
            noise_processor=noise_factory(self.settings.noise).name,
            ready=self.separator is not None,
            model_state=self.model_state,
            live=self.streaming_ready,
            streaming_ready=self.streaming_ready,
            streaming_error=self.streaming_error,
            engine=(
                self.separator.engine
                if self.separator and hasattr(self.separator, "engine")
                else {"rtfs": "RTFS-Net-4-LRS2", "av-mossformer2": "AV-MossFormer2-TSE-16K"}[
                    self.settings.engine
                ]
            ),
            device=self.separator.device if self.separator else None,
            error=self.model_error,
            max_upload_bytes=self.settings.max_upload_bytes,
            max_duration=self.settings.max_duration,
            queued=self.queue.qsize(),
            window_seconds=profile.duration,
            stride_seconds=profile.stride_samples / 16000,
        )

    def analyse(self, identity: str, region: Box | None = None):
        with self.lock:
            clip = self._clip(identity)
            if clip.busy or clip.status not in {"uploading", "ready"}:
                raise ServiceError("clip_busy", "Clip analysis is already pending", 409)
            previous = clip.status
            clip.status = "queued"
            clip.busy = True
            try:
                self.submit(lambda: self._analyse(clip, region))
            except ServiceError:
                clip.status = previous
                clip.busy = False
                raise

    def _analyse(self, clip: Clip, region: Box | None):
        try:
            if clip.cancel.is_set():
                return
            with self.lock:
                clip.status = "analysing"
            media = decode_media(clip.path, MediaLimits(max_duration=self.settings.max_duration))
            if clip.cancel.is_set():
                return
            tracks = [manual_track(media, region)] if region else track_faces(media)
            if clip.cancel.is_set():
                return
            with self.lock:
                clip.tracks = (
                    (
                        [track for track in clip.tracks if not track_in_region(track, region)]
                        + tracks
                    )
                    if region
                    else tracks
                )
                clip.media = MediaView(
                    width=media.width,
                    height=media.height,
                    duration=media.duration,
                    sample_count=media.audio.size,
                    frame_count=len(media.frames),
                )
                clip.status = "ready"
                clip.error = None
        except Exception as exc:
            logger.info("Clip analysis failed: %s", exc)
            with self.lock:
                clip.status = "ready" if region and clip.media else "failed"
                clip.error = ErrorView(
                    code="invalid_region" if region else "invalid_media", message=str(exc)
                )
        finally:
            with self.lock:
                clip.busy = False
                clip.touched = self.clock()

    def extract(self, identity: str, target: str, generation: int) -> Job:
        with self.lock:
            clip = self._clip(identity)
            if clip.status != "ready":
                raise ServiceError("clip_not_ready", "Wait for clip analysis", 409)
            track = next((t for t in clip.tracks if t.id == target), None)
            if track is None:
                raise ServiceError("invalid_target", "Select a visible face from this clip", 422)
            if self.separator is None:
                raise ServiceError(
                    "model_unready", "Run model setup and restart the local service", 503
                )
            if (
                sum(j.clip_id == identity for j in self.jobs.values())
                >= self.settings.max_jobs_per_clip
            ):
                raise ServiceError("job_limit", "Clip job limit reached; reload the clip", 429)
            job = Job(uuid4().hex, clip.id, target, generation, self.clock())
            self.submit(lambda: self._extract(clip, track, job))
            self.jobs[job.id] = job
            return job

    def _extract(self, clip: Clip, track: FaceTrack, job: Job):
        directory = clip.path.parent / job.id
        reservation = 0

        def cancelled():
            return job.cancel.is_set() or clip.cancel.is_set() or self.stopping.is_set()

        def progress(value):
            with self.lock:
                job.progress = value

        try:
            if cancelled():
                raise ExtractionCancelled()
            with self.lock:
                job.status = "running"
            media = decode_media(clip.path, MediaLimits(max_duration=self.settings.max_duration))
            result = extract_track(media, track, self.separator, cancelled, progress)
            if cancelled():
                raise ExtractionCancelled()
            reservation = 2 * clip.path.stat().st_size + result.audio.size * 4 + 65536
            self.reserve(reservation)
            try:
                audio, preview = export_result(clip.path, result, directory)
            finally:
                self.release(reservation)
                reservation = 0
            if cancelled():
                raise ExtractionCancelled()
            with self.lock:
                self.ensure_capacity(0)
                job.audio, job.preview = audio, preview
                job.elapsed_seconds = result.elapsed_seconds
                job.window_p95_seconds = float(np.percentile(result.window_seconds, 95))
                job.device = self.separator.device
                job.status = "done"
                job.progress = 1
        except ExtractionCancelled:
            with self.lock:
                job.status = "cancelled"
        except Exception as exc:
            with self.lock:
                job.status = "cancelled" if cancelled() else "failed"
                job.error = (
                    None if cancelled() else ErrorView(code="extraction_failed", message=str(exc))
                )
        finally:
            with self.lock:
                if job.status != "done":
                    shutil.rmtree(directory, ignore_errors=True)
                job.touched = self.clock()
                clip.touched = self.clock()

    def cancel_job(self, identity: str):
        with self.lock:
            job = self._job(identity)
            job.cancel.set()
            job.status = "cancelled"
            job.audio = job.preview = None
            clip = self.clips.get(job.clip_id)
            if clip:
                shutil.rmtree(clip.path.parent / job.id, ignore_errors=True)

    def output(self, identity: str, kind: str) -> Path:
        with self.lock:
            job = self._job(identity)
            if job.status != "done" or job.cancel.is_set():
                raise ServiceError("output_not_ready", "Focused output is not available", 409)
            path = job.audio if kind == "audio" else job.preview
            if path is None or not path.is_file():
                raise ServiceError("not_found", "Output expired", 404)
            return path

    def remove_clip(self, identity: str):
        with self.lock:
            clip = self._clip(identity)
            clip.cancel.set()
            clip.status = "cancelled"
            for job in list(self.jobs.values()):
                if job.clip_id == identity:
                    self.cancel_job(job.id)
        self.cleanup()

    def cleanup(self):
        with self.lock:
            now = self.clock()
            for identity, clip in list(self.clips.items()):
                active = clip.busy or any(
                    j.clip_id == identity and j.status in {"queued", "running"}
                    for j in self.jobs.values()
                )
                if active:
                    continue
                if clip.cancel.is_set() or now - clip.touched > self.settings.retention_seconds:
                    clip.cancel.set()
                    shutil.rmtree(clip.path.parent, ignore_errors=True)
                    del self.clips[identity]
                    self.jobs = {key: j for key, j in self.jobs.items() if j.clip_id != identity}
