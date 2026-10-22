"""Worker-owned separation and enhancement state for one listening generation."""

from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

from .available_overlap import AvailableOverlap
from .faces import prepare_frames
from .live_overlap import LiveOverlap
from .media import DecodedMedia
from .noise import NoiseSuppressor
from .stream_profile import AudioSpan, CaptureSpan, capture_spans_between


@dataclass(frozen=True)
class ProcessedAudio:
    span: AudioSpan
    captures: list[CaptureSpan]
    timings: dict[str, float]


class StreamProcessor:
    def __init__(self, separator, profile, noise_factory=NoiseSuppressor):
        self.separator = separator
        self.profile = profile
        self.overlap = LiveOverlap(profile)
        self.available_overlap = AvailableOverlap()
        self.available = False
        self.noise = noise_factory()
        self.generation = -1
        self.captures = []
        self.finished = False

    def reset(self, generation):
        self.generation = generation
        self.overlap.reset()
        self.available_overlap.reset()
        self.available = False
        self.noise.reset()
        self.captures.clear()
        self.finished = False

    def _remember(self, spans):
        end = self.captures[-1].end_sample if self.captures else -1
        for span in spans:
            start = max(end, span.start_sample)
            if start < span.end_sample:
                self.captures.append(
                    CaptureSpan(
                        start,
                        span.end_sample,
                        span.capture_time + (start - span.start_sample) / 16000,
                    )
                )
                end = span.end_sample

    def _package(self, spans, timings):
        result = []
        for span in spans:
            end = span.start_sample + span.pcm.size
            captures = capture_spans_between(self.captures, span.start_sample, end)
            result.append(ProcessedAudio(span, captures, timings))
            self.captures = [s for s in self.captures if s.end_sample > end]
        return result

    def process(self, window, track, generation):
        if generation != self.generation or self.finished:
            raise ValueError("stream generation must be reset before processing")
        self.available = window.emit_start_sample is not None
        captures = window.captures
        if self.available:
            captures = capture_spans_between(
                captures, window.emit_start_sample, window.emit_start_sample + window.emit_samples
            )
        self._remember(captures)
        duration = window.audio.size / 16000
        begin = perf_counter()
        media = DecodedMedia(
            Path("."),
            window.audio,
            window.frames,
            window.timestamps,
            window.frames[0].shape[1],
            window.frames[0].shape[0],
            duration,
        )
        frames = prepare_frames(media, track, window.start, duration, self.separator.engine_key)
        prepared = perf_counter()
        focused = self.separator.extract(window.audio, frames)
        extracted = perf_counter()
        if self.available:
            spans = self.available_overlap.push(
                window.start_sample, focused, window.emit_start_sample, window.emit_samples
            )
        else:
            spans = self.overlap.push(
                window.start_sample,
                focused,
                source_end_sample=window.start_sample + window.valid_samples,
            )
        blended = perf_counter()
        enhanced = [item for span in spans for item in self.noise.process(span)]
        done = perf_counter()
        return self._package(
            enhanced,
            {
                "preparation_seconds": prepared - begin,
                "extraction_seconds": extracted - prepared,
                "overlap_seconds": blended - extracted,
                "enhancement_seconds": done - blended,
                "processing_seconds": done - begin,
            },
        )

    def finish(self, source_end_sample):
        if self.finished:
            return []
        begin = perf_counter()
        tails = (
            self.available_overlap.flush(source_end_sample)
            if self.available
            else self.overlap.flush(source_end_sample)
        )
        spans = [item for tail in tails for item in self.noise.process(tail)]
        spans += self.noise.flush()
        self.finished = True
        return self._package(spans, {"processing_seconds": perf_counter() - begin})

    def close(self):
        self.noise.close()
