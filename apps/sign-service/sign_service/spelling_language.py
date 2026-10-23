"""Generic English decoding: word boundaries and missing repeated letters only.

No substitutions, arbitrary inserted letters, video names or demo phrase list.
The original visual spelling remains available in every result.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from importlib.resources import files


def collapse_repeats(text):
    return re.sub(r"(.)\1+", r"\1", text)


def repeats_only(raw, candidate):
    # Candidate may add adjacent copies, but may never remove observed letters.
    at = 0
    previous = None
    for letter in candidate:
        if at < len(raw) and raw[at] == letter:
            previous = letter
            at += 1
        elif letter != previous:
            return False
    return at == len(raw)


@dataclass(frozen=True)
class SpellingResult:
    raw_letters: str
    letters: str
    text: str
    used_language_model: bool


class RepeatAwareEnglishDecoder:
    def __init__(self, frequencies=None):
        if frequencies is None:
            frequencies = {}
            path = files("symspellpy").joinpath("frequency_dictionary_en_82_765.txt")
            for row in path.read_text(encoding="utf-8").splitlines():
                word, count = row.rsplit(" ", 1)
                if word.isascii() and word.isalpha():
                    frequencies[word] = int(count)
        total = max(sum(frequencies.values()), 1)
        self.words = {}
        self.max_length = 0
        for word, count in frequencies.items():
            word = word.upper()
            if not word.isascii() or not word.isalpha() or len(word) > 32:
                continue
            key = collapse_repeats(word)
            self.words.setdefault(key, []).append((word, math.log(max(count, 1) / total)))
            self.max_length = max(self.max_length, len(word))

    def decode(self, raw):
        raw = raw.upper()
        unchanged = SpellingResult(raw, raw, raw, False)
        if not raw or not raw.isascii() or not raw.isalpha() or len(raw) > 128:
            return unchanged
        # Fully dictionary-supported paths only; otherwise preserve arbitrary spelling.
        best = [None] * (len(raw) + 1)
        best[0] = (0.0, [])
        for end in range(1, len(raw) + 1):
            for start in range(max(0, end - self.max_length), end):
                if best[start] is None:
                    continue
                part = raw[start:end]
                for word, log_frequency in self.words.get(collapse_repeats(part), []):
                    if not repeats_only(part, word):
                        continue
                    # An observed letter always costs less than inventing a duplicate.
                    score = best[start][0] + log_frequency - 1.5 * (len(word) - len(part))
                    if best[end] is None or score > best[end][0]:
                        best[end] = (score, [*best[start][1], word])
        if best[-1] is None:
            return unchanged
        text = " ".join(best[-1][1])
        letters = text.replace(" ", "")
        return SpellingResult(raw, letters, text, letters != raw or " " in text)
