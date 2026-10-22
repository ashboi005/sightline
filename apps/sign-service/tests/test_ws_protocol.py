"""Executable websocket contract test.

This test uses the real websocket state machine and a deterministic recognizer
only for the model output, so it is repeatable without a webcam or a calibrated
prototype file::

    python tests/test_ws_protocol.py
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import websockets

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps" / "sign-service"))

from sign_service.model import VOCABULARY  # noqa: E402
from sign_service.recognizer import ScriptedRecognizer  # noqa: E402
from sign_service.server import make_handler  # noqa: E402
from sign_service.model import Prediction  # noqa: E402


SCHEMA_PATH = ROOT / "packages" / "contracts" / "json-schema" / "sign-service.message.json"
MESSAGE_VALIDATOR = None
try:
    from jsonschema import Draft202012Validator  # type: ignore

    if SCHEMA_PATH.exists():
        MESSAGE_VALIDATOR = Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))
except ImportError:
    pass


def jpeg_frame() -> str:
    image = np.zeros((32, 32, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return base64.b64encode(encoded.tobytes()).decode("ascii")


class LetterSequenceRecognizer:
    vocabulary = VOCABULARY
    model_name = "test-letters"
    load_error = None

    def __init__(self) -> None:
        self.frame = 0

    def reset(self) -> None:
        self.frame = 0

    def close(self) -> None:
        pass

    def process(self, jpeg: bytes, ts: int):
        from sign_service.recognizer import FrameResult

        _ = jpeg, ts
        self.frame += 1
        if self.frame <= 4:
            return FrameResult(1, Prediction("A", 0.9, "FINGERSPELL", "test"))
        if self.frame <= 8:
            return FrameResult(1, Prediction("B", 0.9, "FINGERSPELL", "test"))
        if self.frame <= 12:
            return FrameResult(1, Prediction("C", 0.9, "FINGERSPELL", "test"))
        return FrameResult(0, None)


def assert_message_shape(message: dict) -> None:
    if MESSAGE_VALIDATOR is not None:
        errors = list(MESSAGE_VALIDATOR.iter_errors(message))
        assert not errors, "; ".join(error.message for error in errors)
    assert isinstance(message.get("type"), str)
    assert isinstance(message.get("ts"), int) and message["ts"] >= 0
    if message["type"] == "service.ready":
        assert message["protocolVersion"] == "1"
        assert isinstance(message["model"], str) and message["model"]
        assert isinstance(message["vocabulary"], list)
        assert set(VOCABULARY).issubset(message["vocabulary"])
    elif message["type"] == "hands.status":
        assert message["handsDetected"] in (0, 1, 2)
    elif message["type"] == "sign.partial":
        assert isinstance(message["gloss"], str)
        assert 0 <= message["confidence"] <= 1
    elif message["type"] == "sign.token":
        token = message["token"]
        assert token["id"].startswith("tok_")
        assert token["kind"] in {"SIGN", "FINGERSPELL", "NUMBER"}
        assert 0 <= token["confidence"] <= 1
        assert isinstance(token["ts"], int)
    elif message["type"] == "phrase.end":
        assert isinstance(message["tokenIds"], list)
    elif message["type"] == "error":
        assert message["code"] == "BAD_MESSAGE"
        assert isinstance(message["message"], str)
    else:
        raise AssertionError(f"unexpected message type: {message['type']}")


async def receive_until(ws, messages: list[dict], predicate, timeout: float = 3.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = max(0.01, deadline - time.monotonic())
        message = json.loads(await asyncio.wait_for(ws.recv(), remaining))
        assert_message_shape(message)
        messages.append(message)
        if predicate(message):
            return message
    raise AssertionError("timed out waiting for websocket message")


async def main() -> None:
    # Load the repository schema when jsonschema is available.  The explicit
    # checks above keep this executable in the minimal service virtualenv.
    if SCHEMA_PATH.exists():
        json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    server = await websockets.serve(make_handler(ScriptedRecognizer), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}/ws") as ws:
            messages: list[dict] = []
            ready = await receive_until(ws, messages, lambda item: item["type"] == "service.ready")
            assert ready["protocolVersion"] == "1"

            await ws.send(json.dumps({
                "type": "stream.start",
                "protocolVersion": "1",
                "source": "SELF",
                "fps": 12,
                "width": 640,
                "height": 480,
            }))
            image = jpeg_frame()
            for seq in range(2):
                await ws.send(json.dumps({"type": "frame", "seq": seq, "image": image, "ts": int(time.time() * 1000)}))
                await asyncio.sleep(0.02)
            await receive_until(ws, messages, lambda item: item["type"] == "hands.status")
            await receive_until(ws, messages, lambda item: item["type"] == "sign.partial")

            for seq in range(2, 7):
                await ws.send(json.dumps({"type": "frame", "seq": seq, "image": image, "ts": int(time.time() * 1000)}))
                await asyncio.sleep(0.02)
            token_message = await receive_until(ws, messages, lambda item: item["type"] == "sign.token")
            token_id = token_message["token"]["id"]

            for seq in range(7, 14):
                await ws.send(json.dumps({"type": "frame", "seq": seq, "image": image, "ts": int(time.time() * 1000)}))
                await asyncio.sleep(0.2)
            phrase = await receive_until(ws, messages, lambda item: item["type"] == "phrase.end", timeout=3.0)
            assert token_id in phrase["tokenIds"]

            await ws.send(json.dumps({"type": "phrase.reset"}))
            await ws.send(json.dumps({"type": "frame", "seq": 14, "image": image, "ts": int(time.time() * 1000)}))
            await asyncio.sleep(0.05)
            await ws.send("not json")
            error = await receive_until(ws, messages, lambda item: item["type"] == "error")
            assert error["code"] == "BAD_MESSAGE"
            await ws.send(json.dumps({"type": "stream.stop"}))
    finally:
        server.close()
        await server.wait_closed()

    print("sign-service websocket protocol test passed")

    letter_server = await websockets.serve(make_handler(LetterSequenceRecognizer), "127.0.0.1", 0)
    letter_port = letter_server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{letter_port}/ws") as ws:
            messages: list[dict] = []
            await receive_until(ws, messages, lambda item: item["type"] == "service.ready")
            await ws.send(json.dumps({
                "type": "stream.start",
                "protocolVersion": "1",
                "source": "SELF",
                "fps": 12,
                "width": 640,
                "height": 480,
            }))
            image = jpeg_frame()
            for seq in range(19):
                await ws.send(json.dumps({"type": "frame", "seq": seq, "image": image, "ts": int(time.time() * 1000)}))
                await asyncio.sleep(0.2 if seq >= 12 else 0.02)
            token = await receive_until(ws, messages, lambda item: item["type"] == "sign.token", timeout=3)
            assert token["token"]["gloss"] == "ABC"
    finally:
        letter_server.close()
        await letter_server.wait_closed()

    print("generic fingerspelling aggregation test passed")


if __name__ == "__main__":
    asyncio.run(main())
