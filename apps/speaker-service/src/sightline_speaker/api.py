"""Loopback-only API; only opaque session identifiers cross this boundary."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware

from .jobs import ServiceError, Store
from .live import serve_live
from .schemas import ClipView, ExtractionRequest, HealthView, JobView, RegionRequest
from .settings import Settings

MIME_TYPES = {
    ".mp4": {"video/mp4"},
    ".mov": {"video/quicktime", "video/mp4"},
    ".webm": {"video/webm"},
    ".mkv": {"video/x-matroska"},
    ".avi": {"video/x-msvideo", "video/avi"},
}


class UploadLimitMiddleware:
    def __init__(self, app, limit: int):
        self.app, self.limit = app, limit + 65536

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("path") != "/clips"
            or scope.get("method") != "POST"
        ):
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        declared = headers.get(b"content-length", b"0")
        try:
            too_large = int(declared) > self.limit
        except ValueError:
            too_large = True
        if too_large:
            await JSONResponse(
                {"code": "upload_too_large", "message": "Video exceeds upload limit"}, 413
            )(scope, receive, send)
            return
        size = 0

        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > self.limit:
                raise HTTPException(413, detail="Video exceeds upload limit")
            return message

        await self.app(scope, bounded_receive, send)


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        app.state.store = store or Store(settings)
        try:
            yield
        finally:
            await asyncio.to_thread(app.state.store.close)

    app = FastAPI(title="Sightline speaker focus", lifespan=lifespan)
    app.add_middleware(UploadLimitMiddleware, limit=settings.max_upload_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.origin],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def local_guard(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin != settings.origin:
            return JSONResponse(
                {"code": "forbidden_origin", "message": "This frontend origin is not allowed"}, 403
            )
        if urlsplit("http://" + request.headers.get("host", "")).hostname not in {
            "localhost",
            "127.0.0.1",
            "::1",
        }:
            return JSONResponse(
                {"code": "forbidden_host", "message": "Use the loopback service address"}, 403
            )
        return await call_next(request)

    @app.exception_handler(ServiceError)
    async def service_error(_request, exc):
        return JSONResponse(exc.view().model_dump(), exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _exc):
        return JSONResponse(
            {"code": "invalid_request", "message": "Request fields are invalid"}, 422
        )

    @app.exception_handler(HTTPException)
    async def http_error(_request, exc):
        code = "upload_too_large" if exc.status_code == 413 else "invalid_request"
        return JSONResponse({"code": code, "message": str(exc.detail)}, exc.status_code)

    @app.get("/health", response_model=HealthView)
    def health(request: Request):
        return request.app.state.store.health()

    @app.post("/clips", response_model=ClipView, status_code=202)
    async def upload(request: Request, file: UploadFile):
        owner: Store = request.app.state.store
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in MIME_TYPES or file.content_type not in MIME_TYPES[suffix]:
            await file.close()
            raise ServiceError("unsupported_upload", "Use MP4, MOV, WebM, MKV or AVI video", 415)
        clip = owner.create_clip(file.filename)
        total = 0
        try:
            with clip.path.open("wb") as target:
                while block := await file.read(1024 * 1024):
                    total += len(block)
                    if total > settings.max_upload_bytes:
                        raise ServiceError("upload_too_large", "Video exceeds upload limit", 413)
                    with owner.lock:
                        owner.ensure_capacity(len(block))
                        target.write(block)
                        target.flush()
                if not total:
                    raise ServiceError("empty_upload", "Video is empty", 422)
            owner.analyse(clip.id)
            return owner.clip_view(clip.id)
        except BaseException:
            # Task cancellation inherits BaseException; partial files must still go.
            owner.remove_clip(clip.id)
            raise
        finally:
            await file.close()

    @app.get("/clips/{identity}", response_model=ClipView)
    def clip(request: Request, identity: str):
        return request.app.state.store.clip_view(identity)

    @app.post("/clips/{identity}/regions", response_model=ClipView, status_code=202)
    def region(request: Request, identity: str, body: RegionRequest):
        owner = request.app.state.store
        owner.analyse(identity, body.box)
        return owner.clip_view(identity)

    @app.post("/clips/{identity}/extract", response_model=JobView, status_code=202)
    def extract(request: Request, identity: str, body: ExtractionRequest):
        owner = request.app.state.store
        job = owner.extract(identity, body.target_id, body.generation)
        return owner.job_view(job.id)

    @app.get("/jobs/{identity}", response_model=JobView)
    def job(request: Request, identity: str):
        return request.app.state.store.job_view(identity)

    @app.delete("/jobs/{identity}", status_code=204)
    def cancel(request: Request, identity: str):
        request.app.state.store.cancel_job(identity)
        return Response(status_code=204)

    @app.get("/jobs/{identity}/audio")
    def audio(request: Request, identity: str):
        path = request.app.state.store.output(identity, "audio")
        return FileResponse(path, media_type="audio/wav", filename="focused.wav")

    @app.get("/jobs/{identity}/preview")
    def preview(request: Request, identity: str):
        path = request.app.state.store.output(identity, "preview")
        return FileResponse(path, media_type="video/mp4", filename="focused-preview.mp4")

    @app.delete("/clips/{identity}", status_code=204)
    def remove(request: Request, identity: str):
        request.app.state.store.remove_clip(identity)
        return Response(status_code=204)

    app.websocket("/live")(serve_live)
    return app
