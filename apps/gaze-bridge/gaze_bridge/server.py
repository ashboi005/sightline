"""
Sightline gaze bridge. OWNER: Ashwath (software). Eye tracker hardware + gaze estimation: Arunya.

Runs on the student's laptop next to the eye tracker. WebSocket SERVER (default ws://localhost:7777) speaking
packages/contracts/src/protocols/gaze-bridge.ts (JSON Schemas: packages/contracts/json-schema/gaze-bridge.*.json).

    tracker.py  →  zones.py (classify + debounce)  →  this file (protocol)

    cd apps/gaze-bridge && uv sync && uv run gaze-bridge --tracker fake
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time

import websockets

from .tracker import TrackerSample, TrackerSource, create_tracker
from .zones import Debouncer, Target, ZoneClassifier, ZoneConfig

PROTOCOL_VERSION = "1"
HEARTBEAT_S = 1.0
TICK_S = 1 / 30
SCENE_EVERY_TICKS = 2  # 15 Hz
POINT_EVERY_TICKS = 2

DEFAULT_TARGETS = [
    Target("teacher", "Teacher", "TEACHER", 0),
    Target("peer_left", "Classmate (left)", "PEER", -45),
    Target("peer_right", "Classmate (right)", "PEER", 50),
]

CALIBRATION_STEPS = [
    ("Look at the dot in the top-left corner", {"x": 0.1, "y": 0.1}),
    ("Look at the dot in the top-right corner", {"x": 0.9, "y": 0.1}),
    ("Look at the dot in the bottom-right corner", {"x": 0.9, "y": 0.9}),
    ("Look at the dot in the bottom-left corner", {"x": 0.1, "y": 0.9}),
    ("Now look up at the board / teacher", None),
]


def now_ms() -> int:
    return int(time.time() * 1000)


class Bridge:
    def __init__(self, tracker: TrackerSource, targets: list[Target] | None = None, auto_advance_s: float = 1.5):
        self.tracker = tracker
        self.targets = targets or list(DEFAULT_TARGETS)
        self.config = ZoneConfig()
        self.classifier = ZoneClassifier(self.targets, self.config)
        self.debouncer = Debouncer()
        self.mode = "DEAF"
        self.calibrated = False
        self.clients: set = set()
        self.point_subscribers: set = set()
        self.latest = TrackerSample(eye="LOST", confidence=0)
        self.auto_advance_s = auto_advance_s
        self._calibration: asyncio.Task | None = None
        self._confirm = asyncio.Event()
        self._calibration_step = -1
        self._samples: list[TrackerSample] = []

    # --- outgoing ---------------------------------------------------------
    def device_status(self) -> dict:
        return {
            "type": "device.status",
            "protocolVersion": PROTOCOL_VERSION,
            "tracker": "CONNECTED" if self.tracker.connected else "DISCONNECTED",
            "calibrated": self.calibrated,
            # Voice isolation lives in the speaker service; the bridge only supplies gaze.
            "audioFocus": "UNAVAILABLE",
            "mode": self.mode,
            "ts": now_ms(),
        }

    def zone_msg(self) -> dict:
        z = self.debouncer.current
        return {"type": "gaze.zone", "zone": z.zone, "targetId": z.target_id, "confidence": round(z.confidence, 3), "ts": now_ms()}

    async def send(self, ws, msg: dict) -> None:
        try:
            await ws.send(json.dumps(msg))
        except websockets.ConnectionClosed:
            self.clients.discard(ws)

    async def broadcast(self, msg: dict) -> None:
        for ws in list(self.clients):
            await self.send(ws, msg)

    # --- tracking loop -------------------------------------------------------
    async def tracking_loop(self) -> None:
        last_heartbeat = 0.0
        tick = 0
        was_connected = self.tracker.connected
        while True:
            tick += 1
            sample = self.tracker.read()
            self.latest = sample
            t = time.monotonic()

            if self.tracker.connected != was_connected:
                was_connected = self.tracker.connected
                await self.broadcast(self.device_status())

            committed = self.debouncer.update(self.classifier.classify(sample), t)
            if committed is not None:
                await self.broadcast(self.zone_msg())
            if t - last_heartbeat >= HEARTBEAT_S:
                last_heartbeat = t
                await self.broadcast(self.zone_msg())

            if tick % SCENE_EVERY_TICKS == 0 and sample.scene is not None:
                x, y = sample.scene
                await self.broadcast(
                    {
                        "type": "gaze.scene",
                        "x": x,
                        "y": y,
                        "valid": sample.eye == "OPEN",
                        "confidence": max(0.0, min(1.0, sample.confidence)),
                        "ts": now_ms(),
                    }
                )
            if tick % POINT_EVERY_TICKS == 0 and sample.screen is not None and self.debouncer.current.zone == "SCREEN":
                x, y = (min(1.0, max(0.0, v)) for v in sample.screen)
                for ws in list(self.point_subscribers):
                    await self.send(ws, {"type": "gaze.point", "x": x, "y": y, "ts": now_ms()})
            await asyncio.sleep(TICK_S)

    # --- calibration -----------------------------------------------------------
    async def calibrate(self) -> None:
        self._samples = []
        try:
            for i, (instruction, target) in enumerate(CALIBRATION_STEPS):
                self._calibration_step = i
                self._confirm.clear()
                await self.broadcast(
                    {
                        "type": "calibration.progress",
                        "step": i,
                        "totalSteps": len(CALIBRATION_STEPS),
                        "instruction": instruction,
                        "target": target,
                        "ts": now_ms(),
                    }
                )
                try:
                    await asyncio.wait_for(self._confirm.wait(), self.auto_advance_s)
                except TimeoutError:
                    pass
                self._samples.append(self.latest)
            board = self._samples[-1]
            if board.pitch is not None and board.eye == "OPEN":
                # Anything at least halfway up to where the board was = BOARD.
                self.config.board_pitch_deg = max(2.0, board.pitch / 2)
            usable = sum(1 for s in self._samples if s.eye == "OPEN")
            self.calibrated = True
            await self.broadcast(
                {
                    "type": "calibration.result",
                    "ok": True,
                    "quality": round(usable / len(self._samples), 3),
                    "message": "Calibration complete",
                    "ts": now_ms(),
                }
            )
            await self.broadcast(self.device_status())
        except asyncio.CancelledError:
            await self.broadcast({"type": "calibration.result", "ok": False, "quality": 0, "message": "Calibration cancelled", "ts": now_ms()})
            raise
        finally:
            self._calibration_step = -1

    # --- incoming --------------------------------------------------------------
    async def handle(self, ws) -> None:
        self.clients.add(ws)
        await self.send(ws, self.device_status())
        await self.send(ws, {"type": "gaze.targets", "targets": [t.view() for t in self.targets], "ts": now_ms()})
        await self.send(ws, self.zone_msg())
        try:
            async for raw in ws:
                try:
                    cmd = json.loads(raw)
                    if not isinstance(cmd, dict) or not isinstance(cmd.get("type"), str):
                        raise ValueError("Command must be an object with a string type")
                    await self.on_command(ws, cmd)
                except (ValueError, KeyError) as exc:
                    code = "BAD_JSON" if isinstance(exc, json.JSONDecodeError) else "VALIDATION_ERROR"
                    await self.send(ws, {"type": "error", "code": code, "message": str(exc), "ts": now_ms()})
        finally:
            self.clients.discard(ws)
            self.point_subscribers.discard(ws)

    async def on_command(self, ws, cmd: dict) -> None:
        kind = cmd["type"]
        if kind == "hello":
            await self.send(ws, self.device_status())
        elif kind == "calibration.start":
            if self._calibration and not self._calibration.done():
                self._calibration.cancel()
            self.calibrated = False
            self._calibration = asyncio.create_task(self.calibrate())
        elif kind == "calibration.confirm":
            if cmd.get("step") == self._calibration_step:
                self._confirm.set()
        elif kind == "calibration.cancel":
            if self._calibration and not self._calibration.done():
                self._calibration.cancel()
        elif kind == "mode.set":
            if cmd.get("mode") not in ("HARD_OF_HEARING", "DEAF"):
                raise ValueError("mode must be HARD_OF_HEARING or DEAF")
            self.mode = cmd["mode"]
            await self.broadcast(self.device_status())
        elif kind == "gaze.point.subscribe":
            (self.point_subscribers.add if cmd.get("enabled") else self.point_subscribers.discard)(ws)
        elif kind in ("audio.focus.lock", "audio.focus.unlock"):
            pass  # reserved: target selection happens in the web app with the speaker service
        else:
            raise ValueError(f"Unknown command type '{kind}'")


async def serve(port: int, tracker: TrackerSource, host: str = "localhost"):
    bridge = Bridge(tracker)
    server = await websockets.serve(bridge.handle, host, port)
    loop_task = asyncio.create_task(bridge.tracking_loop())
    return bridge, server, loop_task


async def run(port: int, tracker_kind: str) -> None:
    _, server, loop_task = await serve(port, create_tracker(tracker_kind))
    print(f"[gaze-bridge] listening on ws://localhost:{port} (tracker: {tracker_kind})")
    try:
        await loop_task
    finally:
        server.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Sightline gaze bridge")
    parser.add_argument("--port", type=int, default=7777)
    parser.add_argument("--tracker", default="fake", help="tracker source (see tracker.create_tracker)")
    args = parser.parse_args()
    asyncio.run(run(args.port, args.tracker))


if __name__ == "__main__":
    main()
