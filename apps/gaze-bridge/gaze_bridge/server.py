"""
Sightline gaze bridge — OWNER: Ashwath (software). Eye tracker hardware + gaze estimation: Arunya.

Runs on the student's laptop next to the eye tracker. WebSocket SERVER on ws://localhost:7777 that speaks
the protocol in packages/contracts/src/protocols/gaze-bridge.ts (JSON Schemas in
packages/contracts/json-schema/gaze-bridge.*.json). Brief: docs/owners/arun.md.

This skeleton already speaks the full protocol with a FAKE tracker. Replace `FakeTracker` with the real
hardware reader and `AudioFocus` with the voice-isolation pipeline — the socket code should not need to change.

    cd apps/gaze-bridge && python -m venv .venv && . .venv/bin/activate && pip install -e .
    gaze-bridge            # or: python -m gaze_bridge.server
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass

import websockets

PROTOCOL_VERSION = "1"
PORT = int(os.environ.get("GAZE_BRIDGE_PORT", "7777"))
DEBOUNCE_S = 0.15  # a zone must be stable this long before we announce it
HEARTBEAT_S = 1.0
TICK_S = 1 / 30

# Zones: SCREEN | BOARD | PERSON | AWAY | UNKNOWN (see contracts/domain/gaze.ts)


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class GazeReading:
    zone: str
    target_id: str | None
    confidence: float


class FakeTracker:
    """TODO(arunya → ashwath): plug in the real tracker. read() is called ~30x/second and must not block."""

    targets = [
        {"id": "teacher", "label": "Teacher", "kind": "TEACHER", "azimuthDeg": 0},
        {"id": "peer_left", "label": "Classmate (left)", "kind": "PEER", "azimuthDeg": -45},
    ]

    def __init__(self) -> None:
        self.connected = True
        self.calibrated = False

    def read(self) -> GazeReading:
        # 20 s on screen, 6 s on the board, repeat
        phase = time.time() % 26
        if phase < 20:
            return GazeReading("SCREEN", None, 0.95)
        return GazeReading("BOARD", "teacher", 0.9)


class AudioFocus:
    """TODO(ashwath): voice isolation. Steer beamforming / source separation toward the target and route to earphones."""

    def __init__(self) -> None:
        self.enabled = False  # only in HARD_OF_HEARING mode
        self.target_id: str | None = None
        self.locked = False

    def focus(self, target_id: str | None) -> bool:
        """Returns True if the focus target changed."""
        if not self.enabled or self.locked or target_id is None or target_id == self.target_id:
            return False
        self.target_id = target_id
        return True


class Bridge:
    def __init__(self) -> None:
        self.tracker = FakeTracker()
        self.audio = AudioFocus()
        self.mode = "DEAF"
        self.clients: set = set()
        self.zone = GazeReading("UNKNOWN", None, 0.0)
        self._candidate: GazeReading | None = None
        self._candidate_since = 0.0

    # --- outgoing ---------------------------------------------------------
    def device_status(self) -> dict:
        return {
            "type": "device.status",
            "protocolVersion": PROTOCOL_VERSION,
            "tracker": "CONNECTED" if self.tracker.connected else "DISCONNECTED",
            "calibrated": self.tracker.calibrated,
            "audioFocus": "ACTIVE" if self.audio.enabled else "IDLE",
            "mode": self.mode,
            "ts": now_ms(),
        }

    def zone_msg(self) -> dict:
        z = self.zone
        return {"type": "gaze.zone", "zone": z.zone, "targetId": z.target_id, "confidence": z.confidence, "ts": now_ms()}

    def focus_msg(self) -> dict:
        label = next((t["label"] for t in self.tracker.targets if t["id"] == self.audio.target_id), None)
        return {"type": "audio.focus", "targetId": self.audio.target_id, "label": label, "locked": self.audio.locked, "ts": now_ms()}

    async def broadcast(self, msg: dict) -> None:
        data = json.dumps(msg)
        for ws in list(self.clients):
            try:
                await ws.send(data)
            except websockets.ConnectionClosed:
                self.clients.discard(ws)

    # --- loops ------------------------------------------------------------
    async def tracking_loop(self) -> None:
        last_heartbeat = 0.0
        while True:
            reading = self.tracker.read()
            t = time.monotonic()
            if (reading.zone, reading.target_id) != (self.zone.zone, self.zone.target_id):
                if self._candidate is None or (reading.zone, reading.target_id) != (self._candidate.zone, self._candidate.target_id):
                    self._candidate, self._candidate_since = reading, t
                elif t - self._candidate_since >= DEBOUNCE_S:
                    self.zone, self._candidate = reading, None
                    await self.broadcast(self.zone_msg())
                    if self.audio.focus(reading.target_id):
                        await self.broadcast(self.focus_msg())
            else:
                self._candidate = None
            if t - last_heartbeat >= HEARTBEAT_S:
                last_heartbeat = t
                await self.broadcast(self.zone_msg())
            await asyncio.sleep(TICK_S)

    async def calibrate(self) -> None:
        # TODO(ashwath): real calibration — wait for a stable fixation on each target before advancing.
        steps = [
            ("Look at the dot in the top-left corner", {"x": 0.1, "y": 0.1}),
            ("Look at the dot in the top-right corner", {"x": 0.9, "y": 0.1}),
            ("Look at the dot in the bottom-right corner", {"x": 0.9, "y": 0.9}),
            ("Look at the dot in the bottom-left corner", {"x": 0.1, "y": 0.9}),
            ("Now look up at the board / teacher", None),
        ]
        for i, (instruction, target) in enumerate(steps):
            await self.broadcast({"type": "calibration.progress", "step": i, "totalSteps": len(steps), "instruction": instruction, "target": target, "ts": now_ms()})
            await asyncio.sleep(1.5)
        self.tracker.calibrated = True
        await self.broadcast({"type": "calibration.result", "ok": True, "quality": 0.9, "message": "Calibration complete", "ts": now_ms()})
        await self.broadcast(self.device_status())

    # --- incoming ---------------------------------------------------------
    async def handle(self, ws) -> None:
        self.clients.add(ws)
        await ws.send(json.dumps(self.device_status()))
        await ws.send(json.dumps({"type": "gaze.targets", "targets": self.tracker.targets, "ts": now_ms()}))
        await ws.send(json.dumps(self.zone_msg()))
        try:
            async for raw in ws:
                try:
                    cmd = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send(json.dumps({"type": "error", "code": "BAD_JSON", "message": "Frames must be JSON", "ts": now_ms()}))
                    continue
                await self.on_command(cmd)
        finally:
            self.clients.discard(ws)

    async def on_command(self, cmd: dict) -> None:
        kind = cmd.get("type")
        if kind == "hello":
            await self.broadcast(self.device_status())
        elif kind == "calibration.start":
            asyncio.create_task(self.calibrate())
        elif kind == "mode.set":
            self.mode = cmd["mode"]
            self.audio.enabled = self.mode == "HARD_OF_HEARING"
            await self.broadcast(self.device_status())
        elif kind == "audio.focus.lock":
            self.audio.target_id, self.audio.locked = cmd["targetId"], True
            await self.broadcast(self.focus_msg())
        elif kind == "audio.focus.unlock":
            self.audio.locked = False
            await self.broadcast(self.focus_msg())
        # TODO(ashwath): calibration.confirm, calibration.cancel, gaze.point.subscribe


async def run() -> None:
    bridge = Bridge()
    async with websockets.serve(bridge.handle, "localhost", PORT):
        print(f"[gaze-bridge] listening on ws://localhost:{PORT}")
        await bridge.tracking_loop()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
