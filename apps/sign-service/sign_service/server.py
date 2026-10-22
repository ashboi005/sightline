"""WebSocket server for Sightline's sign-language recognizer."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

import websockets

from .model import VOCABULARY, Prediction
from .recognizer import Recognizer


PROTOCOL_VERSION = "1"
MODEL_NAME = "hf-asl-alphabet-wlasl-v2"
PORT = int(os.environ.get("PORT", os.environ.get("SIGN_SERVICE_PORT", "7788")))
PHRASE_END_AFTER_S = 1.0
STALE_FRAME_MS = 150
STABILITY_FRAMES = 4


def now_ms() -> int:
    return int(time.time() * 1000)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _bad(message: str) -> dict[str, Any]:
    return {"type": "error", "code": "BAD_MESSAGE", "message": message, "ts": now_ms()}


def validate_command(command: Any) -> tuple[bool, str]:
    if not isinstance(command, dict):
        return False, "message must be a JSON object"
    kind = command.get("type")
    if kind == "stream.start":
        if set(command) != {"type", "protocolVersion", "source", "fps", "width", "height"}:
            return False, "stream.start contains unknown fields"
        required = ("protocolVersion", "source", "fps", "width", "height")
        if any(key not in command for key in required):
            return False, "stream.start requires protocolVersion, source, fps, width, and height"
        if command["protocolVersion"] != PROTOCOL_VERSION:
            return False, "unsupported protocolVersion"
        if command["source"] not in {"SELF", "PEER"}:
            return False, "source must be SELF or PEER"
        if not _is_int(command["fps"]) or not 1 <= command["fps"] <= 30:
            return False, "fps must be an integer from 1 to 30"
        if not _is_int(command["width"]) or command["width"] <= 0:
            return False, "width must be a positive integer"
        if not _is_int(command["height"]) or command["height"] <= 0:
            return False, "height must be a positive integer"
        return True, ""
    if kind == "frame":
        if set(command) != {"type", "seq", "image", "ts"}:
            return False, "frame contains unknown fields"
        required = ("seq", "image", "ts")
        if any(key not in command for key in required):
            return False, "frame requires seq, image, and ts"
        if not _is_int(command["seq"]) or command["seq"] < 0:
            return False, "seq must be a non-negative integer"
        if not isinstance(command["image"], str) or not command["image"]:
            return False, "image must be a base64 string"
        if not _is_int(command["ts"]) or command["ts"] < 0:
            return False, "ts must be a non-negative integer"
        try:
            base64.b64decode(command["image"], validate=True)
        except (ValueError, binascii.Error):
            return False, "image must contain valid base64"
        return True, ""
    if kind in {"stream.stop", "phrase.reset"}:
        if set(command) != {"type"}:
            return False, f"{kind} contains unknown fields"
        return True, ""
    return False, "unknown command type"


@dataclass
class StreamState:
    streaming: bool = False
    source: str = "SELF"
    token_ids: list[str] = field(default_factory=list)
    prediction_queue: deque[Prediction] = field(default_factory=lambda: deque(maxlen=8))
    stable_gloss: str | None = None
    stable_count: int = 0
    last_committed_gloss: str | None = None
    spelled_letters: list[tuple[str, float]] = field(default_factory=list)
    last_spelled_letter: str | None = None
    hands_down_since: float | None = None
    last_status_at: float = 0.0
    last_hands_detected: int | None = None
    last_partial_at: float = 0.0
    generation: int = 0
    processing: bool = False

    def reset_recognition(self) -> None:
        self.prediction_queue.clear()
        self.stable_gloss = None
        self.stable_count = 0
        self.last_committed_gloss = None
        self.spelled_letters.clear()
        self.last_spelled_letter = None
        self.hands_down_since = None
        self.last_status_at = 0.0
        self.last_hands_detected = None
        self.last_partial_at = 0.0
        self.generation += 1

    def reset_all(self, streaming: bool | None = None, source: str | None = None) -> None:
        if streaming is not None:
            self.streaming = streaming
        if source is not None:
            self.source = source
        self.token_ids.clear()
        self.reset_recognition()


def _token_kind(prediction: Prediction) -> str:
    if prediction.kind in {"SIGN", "FINGERSPELL", "NUMBER"}:
        return prediction.kind
    return "SIGN"


async def handle(ws: Any, recognizer_factory: Callable[[], Any] = Recognizer) -> None:
    recognizer = recognizer_factory()
    state = StreamState()
    send_lock = asyncio.Lock()
    tasks: set[asyncio.Task[Any]] = set()

    async def send(message: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send(json.dumps(message, separators=(",", ":")))

    async def emit_token(gloss: str, kind: str, confidence: float) -> None:
        if not gloss or (gloss == state.last_committed_gloss and state.hands_down_since is None):
            return
        timestamp = now_ms()
        token = {
            "id": f"tok_{uuid.uuid4().hex[:8]}",
            "gloss": gloss,
            "kind": kind,
            "confidence": round(max(0.0, min(1.0, confidence)), 2),
            "ts": timestamp,
        }
        state.token_ids.append(token["id"])
        state.last_committed_gloss = gloss
        await send({"type": "sign.token", "token": token, "ts": timestamp})

    async def flush_spelling() -> None:
        if not state.spelled_letters:
            return
        gloss = "".join(letter for letter, _ in state.spelled_letters)
        confidence = min(confidence for _, confidence in state.spelled_letters)
        state.spelled_letters.clear()
        state.last_spelled_letter = None
        await emit_token(gloss, "FINGERSPELL", confidence)

    async def commit_prediction(prediction: Prediction) -> None:
        if prediction.kind == "FINGERSPELL" and len(prediction.gloss) == 1 and prediction.gloss.isalpha():
            letter = prediction.gloss.upper()
            # A held letter is one letter. The model must change its output
            # before another letter is added; a pause/hands-down flushes the
            # accumulated arbitrary spelling word.
            if letter != state.last_spelled_letter:
                state.spelled_letters.append((letter, prediction.confidence))
                state.last_spelled_letter = letter
            return
        await flush_spelling()
        await emit_token(prediction.gloss, _token_kind(prediction), prediction.confidence)

    async def process_frame(command: dict[str, Any], generation: int) -> None:
        try:
            jpeg = base64.b64decode(command["image"], validate=True)
            result = await asyncio.to_thread(recognizer.process, jpeg, command["ts"])
            if generation != state.generation or not state.streaming:
                return
            monotonic_now = time.monotonic()
            hands = int(result.hands_detected)
            if state.last_hands_detected != hands or monotonic_now - state.last_status_at >= 0.2:
                state.last_status_at = monotonic_now
                state.last_hands_detected = hands
                await send({"type": "hands.status", "handsDetected": max(0, min(2, hands)), "ts": now_ms()})

            prediction = result.partial
            if hands == 0:
                if state.hands_down_since is None:
                    state.hands_down_since = monotonic_now
                    state.stable_gloss = None
                    state.stable_count = 0
                    state.last_committed_gloss = None
                if (state.token_ids or state.spelled_letters) and monotonic_now - state.hands_down_since >= PHRASE_END_AFTER_S:
                    await flush_spelling()
                if state.token_ids and monotonic_now - state.hands_down_since >= PHRASE_END_AFTER_S:
                    await send({"type": "phrase.end", "tokenIds": list(state.token_ids), "ts": now_ms()})
                    state.token_ids.clear()
                return

            if state.hands_down_since is not None:
                state.hands_down_since = None
                state.last_committed_gloss = None

            if prediction is None:
                state.prediction_queue.clear()
                state.stable_gloss = None
                state.stable_count = 0
                return

            state.prediction_queue.append(prediction)
            spelling_partial = None
            if prediction.kind == "FINGERSPELL" and len(prediction.gloss) == 1 and prediction.gloss.isalpha():
                spelling_partial = "".join(letter for letter, _ in state.spelled_letters) + prediction.gloss.upper()
            should_partial = (
                0.55 <= prediction.confidence <= 0.78
                or spelling_partial is not None and prediction.confidence >= 0.78
            )
            if should_partial and monotonic_now - state.last_partial_at >= 0.25:
                state.last_partial_at = monotonic_now
                await send({
                    "type": "sign.partial",
                    "gloss": spelling_partial or prediction.gloss,
                    "confidence": round(prediction.confidence, 2),
                    "ts": now_ms(),
                })

            if prediction.confidence >= 0.78:
                if prediction.gloss == state.stable_gloss:
                    state.stable_count += 1
                else:
                    state.stable_gloss = prediction.gloss
                    state.stable_count = 1
                if state.stable_count >= STABILITY_FRAMES:
                    await commit_prediction(prediction)
                    state.stable_count = 0
                    state.stable_gloss = None
            else:
                state.stable_gloss = None
                state.stable_count = 0
        except Exception as exc:
            await send(_bad(f"could not process frame: {exc}"))
        finally:
            state.processing = False

    async def reset_stream(streaming: bool | None = None, source: str | None = None) -> None:
        state.reset_all(streaming=streaming, source=source)
        reset = getattr(recognizer, "reset", None)
        if reset is not None:
            reset()

    try:
        await send({
            "type": "service.ready",
            "protocolVersion": PROTOCOL_VERSION,
            "model": getattr(recognizer, "model_name", MODEL_NAME),
            "vocabulary": getattr(recognizer, "vocabulary", VOCABULARY),
            "ts": now_ms(),
        })
        if getattr(recognizer, "load_error", None):
            await send({
                "type": "error",
                "code": "MODEL_UNAVAILABLE",
                "message": getattr(recognizer, "load_error"),
                "ts": now_ms(),
            })
        async for raw in ws:
            try:
                command = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
                await send(_bad("messages must be valid JSON"))
                continue
            valid, message = validate_command(command)
            if not valid:
                await send(_bad(message))
                continue

            kind = command["type"]
            if kind == "stream.start":
                await reset_stream(streaming=True, source=command["source"])
                continue
            if kind == "phrase.reset":
                await reset_stream(streaming=state.streaming)
                continue
            if kind == "stream.stop":
                await reset_stream(streaming=False)
                continue
            if kind != "frame":
                continue
            if not state.streaming:
                await send(_bad("send stream.start before frame"))
                continue
            if now_ms() - command["ts"] > STALE_FRAME_MS:
                continue
            if state.processing:
                continue
            state.processing = True
            task = asyncio.create_task(process_frame(command, state.generation))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    finally:
        for task in tasks:
            task.cancel()
        close = getattr(recognizer, "close", None)
        if close is not None:
            close()


def make_handler(recognizer_factory: Callable[[], Any] = Recognizer) -> Callable[[Any], Awaitable[None]]:
    async def handler(ws: Any) -> None:
        await handle(ws, recognizer_factory)

    return handler


async def run() -> None:
    # Download/load the shared pretrained models before accepting clients so
    # the first camera frame is not blocked by a Hub download or model init.
    from .hf_pipeline import shared_pipeline

    await asyncio.to_thread(shared_pipeline().ensure_loaded)
    if shared_pipeline().load_error:
        print(f"[sign-service] model warning: {shared_pipeline().load_error}")
    async with websockets.serve(
        make_handler(),
        "0.0.0.0",
        PORT,
        max_size=4 * 1024 * 1024,
        max_queue=16,
    ):
        print(f"[sign-service] listening on ws://localhost:{PORT}/ws")
        await asyncio.Future()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
