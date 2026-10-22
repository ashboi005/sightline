"""
Tracker input — the ONE place the eye tracker hardware plugs in (hardware + gaze estimation: Arunya).

Implement `TrackerSource.read()` for the real device and register it in `create_tracker()`. Everything above
this file (zones, debounce, protocol, look-to-hear scene gaze) is hardware-agnostic.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Protocol

EYE_STATES = ("OPEN", "BLINK", "LOST")


@dataclass(frozen=True)
class TrackerSample:
    """One gaze estimate. Any field may be None when the tracker can't estimate it this frame."""

    eye: str = "OPEN"  # OPEN | BLINK | LOST
    # Gaze on the laptop screen, normalised 0..1 (origin top-left); None when not on/near the screen.
    screen: tuple[float, float] | None = None
    # Head/gaze direction in the room, degrees: yaw −90 (left) … +90 (right), pitch +up / −down.
    yaw: float | None = None
    pitch: float | None = None
    # Gaze in the forward scene-camera image, normalised 0..1 (look-to-hear face selection).
    scene: tuple[float, float] | None = None
    confidence: float = 0.9


class TrackerSource(Protocol):
    connected: bool

    def read(self) -> TrackerSample:
        """Called ~30x/s from the bridge loop. Must not block; return the latest estimate."""
        ...

    def close(self) -> None: ...


@dataclass
class FakeTracker:
    """Scripted student: screen 20 s → board 6 s → classmate on the left 5 s → screen…"""

    connected: bool = True
    started: float = field(default_factory=time.monotonic)

    def read(self) -> TrackerSample:
        t = (time.monotonic() - self.started) % 31
        wobble = 0.03 * math.sin(time.monotonic() * 2)
        if t < 20:
            return TrackerSample(screen=(0.5 + wobble, 0.6), yaw=0, pitch=-25, scene=(0.5, 0.85))
        if 20.0 <= t < 20.15:
            return TrackerSample(eye="BLINK", confidence=0.1)
        if t < 26:
            return TrackerSample(yaw=2 + wobble, pitch=12, scene=(0.76, 0.55 + wobble))
        return TrackerSample(yaw=-45 + wobble, pitch=0, scene=(0.25, 0.6 + wobble))

    def close(self) -> None:
        self.connected = False


def create_tracker(kind: str) -> TrackerSource:
    if kind == "fake":
        return FakeTracker()
    # TODO(arunya → ashwath): add the real device here, e.g. `if kind == "serial": return SerialTracker(port)`.
    raise ValueError(f"Unknown tracker '{kind}'. Available: fake")
