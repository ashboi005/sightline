"""Loopback live transport; preprocessing and the shared inference queue stay bounded."""

import asyncio
import json
from time import monotonic
from typing import Literal
from urllib.parse import urlsplit

from fastapi import WebSocket
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.websockets import WebSocketDisconnect

from .available_buffer import stream_parameters
from .jobs import ServiceError, Store
from .live_session import LiveSession
from .noise import noise_factory


class LiveConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    type: Literal["configure"]
    protocol_version: Literal[3]
    sample_rate: Literal[16000]
    audio: Literal[True]
    source: Literal["camera", "network", "replay"]
    sync_verified: Literal[True]
    video_offset_ms: float = Field(ge=-500, le=500)
    client_time: float = Field(ge=0)


class TargetConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["target"]
    generation: int = Field(ge=1, le=2**32 - 1)
    target_id: str | None = Field(max_length=64)
    replay_start_sample: int | None = Field(default=None, ge=0, le=2**53 - 1, strict=True)


class RegionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    type: Literal["region"]
    box: tuple[float, float, float, float] | None


async def serve_live(socket: WebSocket):
    owner: Store = socket.app.state.store
    host = urlsplit("http://" + socket.headers.get("host", "")).hostname
    if socket.headers.get("origin") != owner.settings.origin or host not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        await socket.close(code=1008)
        return
    await socket.accept()
    session = None
    acquired = owner.live_lock.acquire(blocking=False)
    sender = None
    try:
        if not acquired:
            raise ServiceError(
                "live_busy",
                "Speaker service is in use in another tab. Close that session, then reconnect.",
                409,
            )
        if owner.queue.unfinished_tasks or owner.worker_busy:
            raise ServiceError("worker_busy", "Wait for file processing to finish", 409)
        if owner.separator is None or owner.model_state != "ready":
            raise ServiceError("model_unready", "Wait for the local model to be ready", 503)
        if not owner.streaming_ready:
            raise ServiceError(
                "streaming_unready", owner.streaming_error or "Streaming is warming up", 503
            )
        config = LiveConfig.model_validate_json(await asyncio.wait_for(socket.receive_text(), 5))
        session = LiveSession(owner, config)
        await session.loop.run_in_executor(session.executor, session.faces.initialize)
        await socket.send_json(
            {
                "type": "ready",
                "generation": 0,
                "device": owner.separator.device,
                "protocol_version": 3,
                "engine": owner.settings.engine,
                **stream_parameters(owner.settings.engine),
                "noise_processor": noise_factory(owner.settings.noise).name,
                "warm_timings": owner.warm_timings,
            }
        )

        async def send_replies():
            while not session.cancel.is_set():
                reply = await session.replies.get()
                if reply["generation"] != session.generation:
                    continue
                await socket.send_json(reply)

        sender = asyncio.create_task(send_replies())
        count, last_count = 0, monotonic()
        while not session.cancel.is_set():
            message = await asyncio.wait_for(socket.receive(), 5)
            if message["type"] == "websocket.disconnect":
                break
            count += 1
            if monotonic() - last_count >= 1:
                count, last_count = 0, monotonic()
            if count > 80:
                raise ValueError("Live message rate limit exceeded")
            if message.get("bytes") is not None:
                await session.packet(message["bytes"])
            else:
                text = message.get("text", "")
                if len(text) > 2048:
                    raise ValueError("Live control message is too large")
                control = json.loads(text)
                if control.get("type") == "stop":
                    break
                if control.get("type") == "heartbeat":
                    continue
                if control.get("type") in {"pause", "resume"}:
                    session.paused = control["type"] == "pause"
                    continue
                if control.get("type") == "end":
                    sample = control.get("source_end_sample")
                    if type(sample) is not int or sample < 0 or sample > 2**53 - 1:
                        raise ValueError("Invalid final source sample")
                    session.end(sample)
                    continue
                if control.get("type") == "target":
                    session.select(TargetConfig.model_validate(control))
                elif control.get("type") == "region":
                    correction = RegionConfig.model_validate(control)
                    session.pause("Region changed; select the corrected face")
                    await session.loop.run_in_executor(
                        session.executor, session.faces.correct, correction.box
                    )
                else:
                    raise ValueError("Unknown live control message")
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except (ValueError, ValidationError, ServiceError, TimeoutError, RuntimeError) as exc:
        try:
            await socket.send_json(
                {
                    "type": "error",
                    "code": getattr(exc, "code", "invalid_live_input"),
                    "message": str(exc),
                    "generation": session.generation if session else 0,
                }
            )
            await socket.close(code=1008)
        except (WebSocketDisconnect, RuntimeError):
            pass
    finally:

        async def cleanup():
            try:
                try:
                    if sender:
                        sender.cancel()
                        await asyncio.gather(sender, return_exceptions=True)
                finally:
                    if session:
                        await session.close()
            finally:
                if acquired:
                    owner.live_lock.release()
                try:
                    await socket.close()
                except (WebSocketDisconnect, RuntimeError):
                    pass

        # Transport cancellation must not strand the worker lease or native state.
        await asyncio.shield(cleanup())
