"""Protocol-v1 WebSocket gateway with bounded tracking and inference."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import time
from collections import deque
from collections.abc import Callable
from typing import Any

import websockets

from .decoding import PhraseDecoder
from .scheduler import LatestInferenceScheduler
from .types import continuity_gap_ms

PROTOCOL_VERSION = "1"
PORT = int(os.environ.get("SIGN_SERVICE_PORT", os.environ.get("PORT", "7788")))
STALE_FRAME_MS = 150


def frame_age_limit_ms() -> int:
    value = int(os.environ.get("SIGN_SERVICE_MAX_FRAME_AGE_MS", str(STALE_FRAME_MS)))
    if not 1 <= value <= 5000:
        raise ValueError("SIGN_SERVICE_MAX_FRAME_AGE_MS must be between 1 and 5000")
    return value


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and abs(value) <= 9007199254740991


def _bad(message: str) -> dict[str, Any]:
    return {"type": "error", "code": "BAD_MESSAGE", "message": message, "ts": now_ms()}


def validate_command(command: Any) -> tuple[bool, str]:
    if not isinstance(command, dict):
        return False, "message must be a JSON object"
    kind = command.get("type")
    if not isinstance(kind, str):
        return False, "type must be a string"
    if kind == "stream.start":
        if set(command) != {"type", "protocolVersion", "source", "fps", "width", "height"}:
            return False, "stream.start contains unknown fields"
        required = ("protocolVersion", "source", "fps", "width", "height")
        if any(key not in command for key in required):
            return False, "stream.start requires protocolVersion, source, fps, width, and height"
        if command["protocolVersion"] != PROTOCOL_VERSION:
            return False, "unsupported protocolVersion"
        if not isinstance(command["source"], str) or command["source"] not in {"SELF", "PEER"}:
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


def _recognizer():
    from .alphabet_recognizer import AlphabetRecognizer

    return AlphabetRecognizer()


async def handle(
    ws: Any,
    recognizer_factory: Callable = _recognizer,
    scheduler: LatestInferenceScheduler | None = None,
) -> None:
    max_frame_age_ms = frame_age_limit_ms()
    initialization_error = None
    try:
        recognizer = await asyncio.to_thread(recognizer_factory)
    except Exception as error:
        recognizer = None
        initialization_error = f"could not initialize recognizer: {error}"
    owns_scheduler = scheduler is None
    scheduler = scheduler or LatestInferenceScheduler()
    stream_key = object()
    decoder = PhraseDecoder(
        fingerspell_threshold=getattr(recognizer, "confidence_threshold", 0.78),
        spelling_decoder=getattr(recognizer, "spelling_decoder", None),
    )
    send_lock = asyncio.Lock()
    transition_lock = asyncio.Lock()
    hand_events = deque()
    pending_evidence: set[tuple[int, int]] = set()
    frame_event = asyncio.Event()
    pending = None
    generation = 0
    streaming = False
    stream_fps = 12
    closing = False
    last_seq = -1
    last_status_at = None
    last_hands = 0
    consumers: set[asyncio.Task] = set()

    async def send(message: dict, epoch: int | None = None) -> None:
        async with send_lock:
            if closing or (epoch is not None and epoch != generation):
                return
            try:
                await ws.send(json.dumps(message, separators=(",", ":"), allow_nan=False))
            except websockets.ConnectionClosed:
                pass

    async def publish(messages: list[dict], epoch: int) -> None:
        for message in messages:
            await send(message, epoch)

    async def drain_hand_events(epoch: int):
        # The caller holds transition_lock. Hand status is immediate, but decoder
        # transitions follow outstanding pre-release evidence in capture order.
        while epoch == generation and hand_events:
            seq, hands, at, ts = hand_events[0]
            if any(g == epoch and observed < seq for g, observed in pending_evidence):
                return
            hand_events.popleft()
            if hands and decoder.down_since is not None:
                await publish(decoder.hands(0, at, ts), epoch)
                if epoch != generation:
                    return
            await publish(decoder.hands(hands, at, ts), epoch)
        if epoch == generation and not hand_events:
            await publish(decoder.hands(last_hands, time.monotonic(), now_ms()), epoch)

    async def consume(future, epoch: int, seq: int, captured_at: float, ts: int):
        key = (epoch, seq)
        try:
            remaining = max(0.001, 1.0 - (time.monotonic() - captured_at))
            result = await asyncio.wait_for(asyncio.shield(future), remaining)
            async with transition_lock:
                if (
                    result is None
                    or closing
                    or not streaming
                    or epoch != generation
                    or time.monotonic() - captured_at > 1.0
                ):
                    return
                await drain_hand_events(epoch)
                if epoch != generation:
                    return
                evidence = result[0]
                await publish(
                    decoder.prediction(evidence.prediction, evidence.observation, ts), epoch
                )
        except asyncio.CancelledError:
            future.cancel()
            raise
        except TimeoutError:
            future.cancel()
        except Exception as error:
            await send(
                {"type": "error", "code": "INFERENCE_ERROR", "message": str(error), "ts": now_ms()},
                epoch,
            )
        finally:
            pending_evidence.discard(key)
            if not closing and epoch == generation:
                async with transition_lock:
                    await drain_hand_events(epoch)

    async def track_frames():
        nonlocal pending, last_status_at, last_hands
        applied_generation = -1
        while True:
            await frame_event.wait()
            frame_event.clear()
            if closing:
                return
            item, pending = pending, None
            if item is None:
                continue
            command, epoch, captured_at = item
            try:
                if epoch != applied_generation:
                    await asyncio.to_thread(recognizer.reset)
                    configure = getattr(recognizer, "configure_frame_rate", None)
                    if configure is not None:
                        await asyncio.to_thread(configure, stream_fps)
                    applied_generation = epoch
                if epoch != generation or not streaming:
                    continue
                jpeg = base64.b64decode(command["image"], validate=True)
                result = await asyncio.to_thread(recognizer.track, jpeg, command["ts"])
                if epoch != generation or not streaming or closing:
                    continue
                async with transition_lock:
                    if epoch != generation or not streaming or closing:
                        continue
                    at = time.monotonic()
                    hands = max(0, min(2, int(result.hands_detected)))
                    if bool(hands) != bool(last_hands):
                        hand_events.append((command["seq"], hands, at, now_ms()))
                    last_hands = hands
                    if last_status_at is None or at - last_status_at >= 0.2:
                        last_status_at = at
                        await send(
                            {"type": "hands.status", "handsDetected": hands, "ts": now_ms()}, epoch
                        )
                    await drain_hand_events(epoch)
                    if not hands or epoch != generation:
                        continue
                    observation = getattr(result, "observation", None)
                    if observation is None:
                        await publish(
                            decoder.prediction(result.partial, command["seq"], now_ms()), epoch
                        )
                    else:
                        future = scheduler.submit(
                            stream_key, lambda value=observation: (recognizer.predict(value),)
                        )
                        pending_evidence.add((epoch, command["seq"]))
                        task = asyncio.create_task(
                            consume(future, epoch, command["seq"], captured_at, command["ts"])
                        )
                        consumers.add(task)
                        task.add_done_callback(consumers.discard)
            except Exception as error:
                await send(_bad(f"could not process frame: {error}"), epoch)

    worker = asyncio.create_task(track_frames())

    def reset(active: bool):
        nonlocal generation, streaming, pending, last_seq, last_hands
        generation += 1
        streaming = active
        pending = None
        last_seq = -1
        last_hands = 0
        decoder.reset()
        hand_events.clear()
        scheduler.discard(stream_key)

    try:
        load_error = initialization_error or recognizer.load_error
        if load_error:
            await send(
                {
                    "type": "error",
                    "code": "MODEL_UNAVAILABLE",
                    "message": load_error,
                    "ts": now_ms(),
                }
            )
        else:
            await send(
                {
                    "type": "service.ready",
                    "protocolVersion": PROTOCOL_VERSION,
                    "model": recognizer.model_name,
                    "vocabulary": recognizer.vocabulary,
                    "ts": now_ms(),
                }
            )
        async for raw in ws:
            try:
                if not isinstance(raw, str):
                    raise ValueError("messages must be JSON text")
                command = json.loads(raw)
            except (ValueError, TypeError):
                await send(_bad("messages must be valid JSON text"))
                continue
            valid, message = validate_command(command)
            if not valid:
                await send(_bad(message))
                continue
            kind = command["type"]
            if kind == "stream.stop":
                reset(False)
            elif kind == "phrase.reset":
                reset(streaming)
            elif kind == "stream.start":
                if load_error:
                    await send(
                        {
                            "type": "error",
                            "code": "MODEL_UNAVAILABLE",
                            "message": load_error,
                            "ts": now_ms(),
                        }
                    )
                else:
                    stream_fps = command["fps"]
                    decoder.max_evidence_gap_ms = continuity_gap_ms(stream_fps)
                    reset(True)
            elif not streaming:
                await send(_bad("send stream.start before frame"))
            elif now_ms() - command["ts"] <= max_frame_age_ms and command["seq"] > last_seq:
                last_seq = command["seq"]
                pending = (command, generation, time.monotonic())
                frame_event.set()
    finally:
        closing = True
        generation += 1
        pending = None
        scheduler.discard(stream_key)
        frame_event.set()
        # Do not close a MediaPipe tracker while its tracking thread is still running.
        await worker
        for task in list(consumers):
            task.cancel()
        await asyncio.gather(*consumers, return_exceptions=True)
        if recognizer is not None:
            await asyncio.to_thread(recognizer.close)
        if owns_scheduler:
            await scheduler.close()


def make_handler(
    recognizer_factory: Callable = _recognizer, scheduler: LatestInferenceScheduler | None = None
):
    async def handler(ws):
        await handle(ws, recognizer_factory, scheduler)

    return handler


async def run() -> None:
    frame_age_limit_ms()  # Validate configuration before loading weights/listening.
    from .landmark_pipeline import shared_pipeline

    pipeline = shared_pipeline()
    await asyncio.to_thread(pipeline.ensure_loaded)
    if pipeline.load_error:
        print(f"[sign-service] MODEL_UNAVAILABLE: {pipeline.load_error}", flush=True)
    scheduler = LatestInferenceScheduler()
    try:
        async with websockets.serve(
            make_handler(scheduler=scheduler),
            "127.0.0.1",
            PORT,
            max_size=4 * 1024 * 1024,
            max_queue=1,
        ):
            print(f"[sign-service] listening on ws://localhost:{PORT}/ws", flush=True)
            await asyncio.Future()
    finally:
        await scheduler.close()
        pipeline.close()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
