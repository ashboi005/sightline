"""Every message the bridge emits must validate against the shared contract (generated JSON Schema)."""

import asyncio
import json
from pathlib import Path

import jsonschema
import websockets

from gaze_bridge.server import serve
from gaze_bridge.tracker import FakeTracker

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[3] / "packages/contracts/json-schema/gaze-bridge.message.json").read_text()
)


async def collect(port: int, seconds: float, commands=()):
    bridge, server, loop_task = await serve(port, FakeTracker())
    bridge.auto_advance_s = 0.05
    seen = []
    try:
        async with websockets.connect(f"ws://localhost:{port}") as ws:
            for cmd in commands:
                await ws.send(json.dumps(cmd))
            end = asyncio.get_running_loop().time() + seconds
            while (remaining := end - asyncio.get_running_loop().time()) > 0:
                try:
                    seen.append(json.loads(await asyncio.wait_for(ws.recv(), remaining)))
                except TimeoutError:
                    break
    finally:
        loop_task.cancel()
        server.close()
        await server.wait_closed()
    return seen


async def test_messages_match_contract_and_cover_protocol():
    seen = await collect(
        17901,
        1.5,
        [
            {"type": "hello", "client": "test", "protocolVersion": "1"},
            {"type": "mode.set", "mode": "HARD_OF_HEARING"},
            {"type": "gaze.point.subscribe", "enabled": True},
            {"type": "calibration.start"},
            {"type": "bogus"},
        ],
    )
    for msg in seen:
        jsonschema.validate(msg, SCHEMA)
    types = {m["type"] for m in seen}
    assert {"device.status", "gaze.targets", "gaze.zone", "gaze.scene", "gaze.point", "calibration.progress", "calibration.result", "error"} <= types
    assert any(m["type"] == "device.status" and m["mode"] == "HARD_OF_HEARING" for m in seen)
    assert any(m["type"] == "gaze.zone" and m["zone"] == "SCREEN" for m in seen)


async def test_malformed_json_returns_error():
    bridge, server, loop_task = await serve(17902, FakeTracker())
    try:
        async with websockets.connect("ws://localhost:17902") as ws:
            await ws.send("{not json")
            for _ in range(10):
                msg = json.loads(await asyncio.wait_for(ws.recv(), 2))
                if msg["type"] == "error":
                    assert msg["code"] == "BAD_JSON"
                    jsonschema.validate(msg, SCHEMA)
                    return
            raise AssertionError("no error frame")
    finally:
        loop_task.cancel()
        server.close()
        await server.wait_closed()
