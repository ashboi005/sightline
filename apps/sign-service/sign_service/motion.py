"""Per-stream geometric movement guard; independent of alphabet labels."""

import numpy as np


class HandMotionGate:
    def __init__(self, max_gap_ms=350):
        self.max_gap_ms = max_gap_ms
        self.reset()

    def reset(self):
        self.previous = self.anchor = None
        self.last_ts = None

    def observe(self, coordinates, ts):
        current = np.asarray(coordinates, dtype=np.float32)
        elapsed = None if self.last_ts is None else (ts - self.last_ts) / 1000
        initial = self.previous is None or elapsed is None or not 0 < elapsed <= self.max_gap_ms / 1000
        moving = initial
        if not initial:
            step = float(np.sqrt(np.mean((current - self.previous) ** 2)))
            drift = float(np.sqrt(np.mean((current - self.anchor) ** 2)))
            # Normalized handshape coordinates tolerate small tracking jitter.
            # The anchor also catches slow reshaping that evades frame-to-frame speed.
            moving = step > max(0.012, 0.3 * elapsed) or drift > 0.055
        if moving:
            self.anchor = current.copy()
        self.previous = current.copy()
        self.last_ts = ts
        return not moving
