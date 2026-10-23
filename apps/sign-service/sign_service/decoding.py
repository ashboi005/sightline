"""Temporal stability and phrase commitment; no model or I/O."""

from __future__ import annotations

import math
import uuid
from collections import deque

from .types import Prediction


class PhraseDecoder:
    def __init__(
        self,
        stable_frames: int = 4,
        phrase_end_s: float = 1.0,
        fingerspell_threshold: float = 0.78,
        spelling_decoder=None,
        letter_hold_s: float = 1.0,
        max_evidence_gap_ms: int = 350,
    ):
        self.fingerspell_threshold = fingerspell_threshold
        self.spelling_decoder = spelling_decoder
        self.stable_frames = stable_frames
        self.phrase_end_s = phrase_end_s
        self.letter_hold_ms = round(letter_hold_s * 1000)
        self.max_evidence_gap_ms = max_evidence_gap_ms
        self.reset()

    def reset(self) -> None:
        self.spelling_results = deque(maxlen=64)
        self.token_ids: list[str] = []
        self.letters: list[tuple[str, float]] = []
        self.last_letter: str | None = None
        self.last_committed: tuple[str, str] | None = None
        self.down_since: float | None = None
        self.last_observation = -1
        self.last_prediction_ts: int | None = None
        self.stable_key: tuple[str, str] | None = None
        self.stable_since: int | None = None
        self.scores: list[float] = []
        self.last_partial_ts = -1000
        self.last_partial = None

    def _clear_stability(self) -> None:
        self.stable_key = None
        self.stable_since = None
        self.scores.clear()

    def _partial(self, candidate: Prediction | None, ts: int) -> list[dict]:
        accepted = "".join(letter for letter, _ in self.letters)
        gloss = accepted
        if candidate is not None:
            if candidate.kind != "FINGERSPELL":
                gloss = candidate.gloss
            elif candidate.gloss != self.last_letter:
                gloss += candidate.gloss
        key = (gloss, accepted)
        if key == self.last_partial and ts - self.last_partial_ts < 250:
            return []
        # No need to publish empty state until a visible guess needs clearing.
        if not gloss and self.last_partial is None:
            return []
        self.last_partial, self.last_partial_ts = key, ts
        message = {
            "type": "sign.partial", "gloss": gloss,
            "confidence": candidate.confidence if candidate is not None else 0.0, "ts": ts,
        }
        if candidate is None or candidate.kind == "FINGERSPELL":
            message["acceptedGloss"] = accepted
        return [message]

    def _emit(self, gloss: str, kind: str, confidence: float, ts: int) -> list[dict]:
        if self.last_committed == (gloss, kind):
            return []
        messages = []
        if len(self.token_ids) >= 64:
            messages.append({"type": "phrase.end", "tokenIds": self.token_ids[:], "ts": ts})
            self.token_ids.clear()
        token = {
            "id": f"tok_{uuid.uuid4().hex}", "gloss": gloss, "kind": kind,
            "confidence": confidence, "ts": ts,
        }
        self.token_ids.append(token["id"])
        self.last_committed = (gloss, kind)
        messages.append({"type": "sign.token", "token": token, "ts": ts})
        return messages

    def _flush_spelling(self, ts: int) -> list[dict]:
        if not self.letters:
            return []
        word = "".join(letter for letter, _ in self.letters)
        words = [word]
        if self.spelling_decoder is not None:
            result = self.spelling_decoder(word)
            self.spelling_results.append(result)
            words = result.text.split()
        confidence = min(score for _, score in self.letters)
        self.letters.clear()
        self.last_letter = None
        messages = []
        for word in words:
            self.last_committed = None
            messages += self._emit(word, "FINGERSPELL", confidence, ts)
        return messages

    def hands(self, count: int, at: float, ts: int) -> list[dict]:
        # Brief detector dropouts must not re-arm a continuously held letter.
        if self.down_since is not None and at - self.down_since >= 0.25:
            self.last_letter = None
            self.last_committed = None
        if count:
            self.down_since = None
            return []
        self._clear_stability()
        if self.down_since is None:
            self.down_since = at
        if at - self.down_since < self.phrase_end_s:
            return self._partial(None, ts)
        messages = self._flush_spelling(ts)
        if self.token_ids:
            messages.append({"type": "phrase.end", "tokenIds": self.token_ids[:], "ts": ts})
            self.token_ids.clear()
        return messages

    def prediction(self, prediction: Prediction | None, observation: int, ts: int) -> list[dict]:
        if observation <= self.last_observation:
            return []
        self.last_observation = observation
        if self.last_prediction_ts is not None and not 0 <= ts - self.last_prediction_ts <= self.max_evidence_gap_ms:
            self._clear_stability()
        self.last_prediction_ts = ts
        if prediction is None:
            self._clear_stability()
            return self._partial(None, ts)
        p = prediction
        if p.kind == "BLANK":
            if not math.isfinite(p.confidence) or not 0.85 <= p.confidence <= 1:
                self._clear_stability()
                return self._partial(None, ts)
            if self.stable_key != ("blank", "BLANK"):
                self._clear_stability()
                self.stable_key = ("blank", "BLANK")
            self.scores.append(p.confidence)
            if len(self.scores) >= self.stable_frames:
                self.last_letter = None
                self.last_committed = None
                self._clear_stability()
            return self._partial(None, ts)
        if (
            p.kind not in {"SIGN", "FINGERSPELL", "NUMBER"}
            or not p.gloss
            or not math.isfinite(p.confidence)
            or not 0 <= p.confidence <= 1
        ):
            self._clear_stability()
            return self._partial(None, ts)
        threshold = self.fingerspell_threshold if p.kind == "FINGERSPELL" else 0.55
        if p.confidence < threshold:
            self._clear_stability()
            return self._partial(None, ts)
        if p.kind == "FINGERSPELL" and p.gloss == self.last_letter:
            self._clear_stability()
            return self._partial(p, ts)
        key = (p.gloss, p.kind)
        if key != self.stable_key:
            self._clear_stability()
            self.stable_key = key
            self.stable_since = ts
        self.scores.append(p.confidence)
        held_long_enough = (
            p.kind != "FINGERSPELL" or ts - self.stable_since >= self.letter_hold_ms
        )
        if len(self.scores) < self.stable_frames or not held_long_enough:
            return self._partial(p, ts)
        confidence = min(self.scores)
        self._clear_stability()
        if p.kind == "FINGERSPELL" and len(p.gloss) == 1 and p.gloss in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            self.letters.append((p.gloss, confidence))
            self.last_letter = p.gloss
            return self._partial(Prediction(p.gloss, confidence, p.kind, p.source), ts)
        messages = self._partial(p, ts)
        messages += self._flush_spelling(ts)
        messages += self._emit(p.gloss, p.kind, confidence, ts)
        return messages
