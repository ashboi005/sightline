"""
Sightline sign service — OWNER: Harnoor.

WebSocket SERVER on ws://localhost:7788/ws speaking packages/contracts/src/protocols/sign-service.ts
(JSON Schemas: packages/contracts/json-schema/sign-service.*.json). Brief: docs/owners/harnoor.md.

The web app streams base64 JPEG webcam frames; you stream back gloss tokens and say when a phrase ended.
Turning gloss into an English sentence + speech is NOT your job (server does it).

This skeleton speaks the full protocol. Replace `Recognizer` with the real model
(e.g. MediaPipe Holistic landmarks -> sequence classifier). The socket code should not need to change.

    cd apps/sign-service && python -m venv .venv && . .venv/bin/activate && pip install -e .
    sign-service            # or: python -m sign_service.server
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import uuid
from dataclasses import dataclass, field

import websockets

PROTOCOL_VERSION = "1"
PORT = int(os.environ.get("SIGN_SERVICE_PORT", "7788"))
PHRASE_END_AFTER_S = 1.0  # hands down this long => phrase.end

VOCABULARY = ["HELLO", "THANK-YOU", "PLEASE", "QUESTION", "WHAT", "REPEAT", "AGAIN", "SLOW", "FORMULA", "BOARD", "WRITE"]


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class FrameResult:
    hands_detected: int
    partial: tuple[str, float] | None = None      # (gloss, confidence) — in-progress guess
    committed: tuple[str, str, float] | None = None  # (gloss, kind SIGN|FINGERSPELL|NUMBER, confidence)


class Recognizer:
    """TODO(harnoor): the real model. process() is called for every frame (~10-15 fps); keep it < 60 ms."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.started = time.monotonic()
        self.emitted = 0  # signs committed in the current cycle
        self.partial_for = -1
        self.cycle = 0

    def process(self, jpeg: bytes, ts: int) -> FrameResult:
        # Fake (time-based, any fps): hands up for 3.9 s committing a sign every 1.2 s, then hands down for 2.1 s.
        elapsed = time.monotonic() - self.started
        cycle, t = divmod(elapsed, 6.0)
        if int(cycle) != self.cycle:
            self.cycle, self.emitted, self.partial_for = int(cycle), 0, -1
        if t >= 3.9:
            return FrameResult(hands_detected=0)
        gloss = VOCABULARY[(self.cycle * 3 + self.emitted) % len(VOCABULARY)]
        if t >= 1.2 * (self.emitted + 1):
            self.emitted += 1
            return FrameResult(hands_detected=2, committed=(gloss, "SIGN", 0.85))
        if t >= 1.2 * self.emitted + 0.6 and self.partial_for != self.emitted:
            self.partial_for = self.emitted
            return FrameResult(hands_detected=2, partial=(gloss, 0.6))
        return FrameResult(hands_detected=2)


@dataclass
class StreamState:
    streaming: bool = False
    source: str = "SELF"
    token_ids: list[str] = field(default_factory=list)
    last_hands_at: float = 0.0
    last_status_at: float = 0.0


async def handle(ws) -> None:
    recognizer = Recognizer()
    state = StreamState()

    async def send(msg: dict) -> None:
        await ws.send(json.dumps(msg))

    await send({"type": "service.ready", "protocolVersion": PROTOCOL_VERSION, "model": "skeleton-fake", "vocabulary": VOCABULARY, "ts": now_ms()})

    async for raw in ws:
        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError:
            await send({"type": "error", "code": "BAD_JSON", "message": "Frames must be JSON", "ts": now_ms()})
            continue

        kind = cmd.get("type")
        if kind == "stream.start":
            state = StreamState(streaming=True, source=cmd.get("source", "SELF"))
            recognizer.reset()
        elif kind == "stream.stop":
            state.streaming = False
        elif kind == "phrase.reset":
            state.token_ids.clear()
            recognizer.reset()
        elif kind == "frame" and state.streaming:
            jpeg = base64.b64decode(cmd["image"])
            result = recognizer.process(jpeg, cmd["ts"])
            t = time.monotonic()

            if t - state.last_status_at >= 0.2:
                state.last_status_at = t
                await send({"type": "hands.status", "handsDetected": result.hands_detected, "ts": now_ms()})
            if result.hands_detected > 0:
                state.last_hands_at = t
            if result.partial:
                gloss, conf = result.partial
                await send({"type": "sign.partial", "gloss": gloss, "confidence": conf, "ts": now_ms()})
            if result.committed:
                gloss, token_kind, conf = result.committed
                token = {"id": f"tok_{uuid.uuid4().hex[:16]}", "gloss": gloss, "kind": token_kind, "confidence": conf, "ts": now_ms()}
                state.token_ids.append(token["id"])
                await send({"type": "sign.token", "token": token, "ts": now_ms()})
            if state.token_ids and result.hands_detected == 0 and t - state.last_hands_at >= PHRASE_END_AFTER_S:
                await send({"type": "phrase.end", "tokenIds": state.token_ids, "ts": now_ms()})
                state.token_ids = []


async def run() -> None:
    async with websockets.serve(handle, "0.0.0.0", PORT, max_size=4 * 1024 * 1024):
        print(f"[sign-service] listening on ws://localhost:{PORT}/ws")
        await asyncio.Future()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
