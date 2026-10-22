"""Pure gaze → zone logic (no I/O), so it can be unit-tested and tuned from calibration."""

from __future__ import annotations

from dataclasses import dataclass

from .tracker import TrackerSample


@dataclass
class Target:
    id: str
    label: str
    kind: str  # TEACHER | PEER | UNKNOWN
    azimuth_deg: float

    def view(self) -> dict:
        return {"id": self.id, "label": self.label, "kind": self.kind, "azimuthDeg": self.azimuth_deg}


@dataclass(frozen=True)
class ZoneReading:
    zone: str  # SCREEN | BOARD | PERSON | AWAY | UNKNOWN
    target_id: str | None
    confidence: float


@dataclass
class ZoneConfig:
    """Thresholds; calibration fills these in (board_pitch from the "look at the board" step)."""

    screen_margin: float = 0.05  # screen point may be slightly off-panel and still count
    board_pitch_deg: float = 5.0  # looking up at least this much (and roughly forward) = BOARD
    board_yaw_deg: float = 30.0
    person_tolerance_deg: float = 15.0
    min_confidence: float = 0.4


class ZoneClassifier:
    def __init__(self, targets: list[Target], config: ZoneConfig | None = None):
        self.targets = targets
        self.config = config or ZoneConfig()

    def classify(self, s: TrackerSample) -> ZoneReading:
        c = self.config
        if s.eye != "OPEN" or s.confidence < c.min_confidence:
            return ZoneReading("UNKNOWN", None, s.confidence)
        if s.screen is not None:
            x, y = s.screen
            if -c.screen_margin <= x <= 1 + c.screen_margin and -c.screen_margin <= y <= 1 + c.screen_margin:
                return ZoneReading("SCREEN", None, s.confidence)
        if s.yaw is None:
            return ZoneReading("AWAY", None, s.confidence)
        person = self._nearest(s.yaw)
        if s.pitch is not None and s.pitch >= c.board_pitch_deg and abs(s.yaw) <= c.board_yaw_deg:
            teacher = next((t for t in self.targets if t.kind == "TEACHER"), None)
            return ZoneReading("BOARD", teacher.id if teacher else None, s.confidence)
        if person is not None:
            return ZoneReading("PERSON", person.id, s.confidence)
        return ZoneReading("AWAY", None, s.confidence)

    def _nearest(self, yaw: float) -> Target | None:
        best = min(self.targets, key=lambda t: abs(t.azimuth_deg - yaw), default=None)
        if best is None or abs(best.azimuth_deg - yaw) > self.config.person_tolerance_deg:
            return None
        return best


class Debouncer:
    """A new zone must hold for `hold_s` before it is announced. UNKNOWN never replaces a known zone."""

    def __init__(self, hold_s: float = 0.15):
        self.hold_s = hold_s
        self.current = ZoneReading("UNKNOWN", None, 0.0)
        self._candidate: ZoneReading | None = None
        self._since = 0.0

    def update(self, reading: ZoneReading, now: float) -> ZoneReading | None:
        """Returns the newly committed reading, or None if nothing changed."""
        if reading.zone == "UNKNOWN" and self.current.zone != "UNKNOWN":
            self._candidate = None
            return None
        same = (reading.zone, reading.target_id) == (self.current.zone, self.current.target_id)
        if same:
            self._candidate = None
            return None
        key = (reading.zone, reading.target_id)
        if self._candidate is None or key != (self._candidate.zone, self._candidate.target_id):
            self._candidate, self._since = reading, now
            return None
        if now - self._since >= self.hold_s:
            self.current, self._candidate = reading, None
            return self.current
        return None
