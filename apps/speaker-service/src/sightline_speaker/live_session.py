"""One bounded stream owner; model and enhancement state stay on the shared worker."""

import asyncio
import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

import numpy as np

from .available_buffer import AvailableBuffer
from .faces import FaceTrack
from .jobs import ServiceError
from .live_faces import LiveFaces, decode_frame
from .noise import noise_factory
from .stream_processor import StreamProcessor
from .stream_profile import profile_for
from .stream_protocol import InputCapacityError, LiveBuffer, decode_packet


class LiveSession:
    def __init__(self, owner, config):
        self.owner = owner
        self.config = config
        self.profile = profile_for(owner.settings.engine)
        # Preserve enough real video for a positive offset plus the existing 150 ms skew limit.
        self.selection_frame_history = max(0, round(config.video_offset_ms * 16)) + 2400
        self.buffer = (
            LiveBuffer(self.profile, video_lag_samples=max(0, round(-config.video_offset_ms * 16)))
            if owner.settings.engine == "av-mossformer2"
            else AvailableBuffer()
        )
        self.faces = LiveFaces()
        self.generation = 0
        self.target = None
        self.cancel = threading.Event()
        self.pending = 0
        self.loop = asyncio.get_running_loop()
        self.replies = asyncio.Queue(maxsize=12)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-face")
        self.processor = None
        self.capture_times: dict[int, float] = {}
        self.last_feed = -1
        self.flow_paused = False
        self.paused = False
        self.end_sample = None
        self.accepted_end = None
        self.last_track = None
        self.drain_track = None
        self.finishing = False

    def put_reply(self, reply):
        if self.cancel.is_set() or reply.get("generation") != self.generation:
            return
        try:
            self.replies.put_nowait(reply)
        except asyncio.QueueFull:
            self.cancel.set()

    def post(self, reply):
        if not self.loop.is_closed():
            self.loop.call_soon_threadsafe(self.put_reply, reply)

    def flow(self, paused, reason="worker"):
        if paused == self.flow_paused:
            return
        self.flow_paused = paused
        self.put_reply(
            {
                "type": "flow",
                "generation": self.generation,
                "action": "pause" if paused else "resume",
                "queued_windows": self.pending,
                "reason": reason,
            }
        )

    def _reset_input(self, *, keep_video: bool):
        cutoff = (
            self.buffer.frames[-1][0] - self.selection_frame_history if self.buffer.frames else 0
        )
        recent_frames = (
            [frame for frame in self.buffer.frames if frame[0] >= cutoff] if keep_video else []
        )
        self.buffer.reset()
        for frame in recent_frames:
            self.buffer.frame(*frame)

    def pause(self, message):
        self.target = None
        self.generation += 1
        self._reset_input(keep_video=True)
        self.put_reply(
            {
                "type": "error",
                "code": "synchronization_or_target_lost",
                "message": message,
                "generation": self.generation,
            }
        )

    def select(self, target):
        if target.generation <= self.generation:
            return
        if target.target_id and target.target_id not in self.faces.tracks:
            raise ValueError("Selected face expired; reacquire it")
        if target.replay_start_sample is not None:
            if self.config.source != "replay" or target.target_id is not None:
                raise ValueError("Replay rewind requires a fresh face selection")
            self.faces.correct(self.faces.region)
            self.last_feed = -1
        self.generation = target.generation
        self.capture_times.clear()
        self.target = target.target_id
        # Keep bounded visual context across confirmation, never old microphone PCM.
        self._reset_input(keep_video=target.replay_start_sample is None)
        self.end_sample = None
        self.accepted_end = None
        self.last_track = None
        self.drain_track = None
        self.finishing = False
        self.paused = False
        self.flow_paused = False
        self.put_reply(
            {"type": "selected", "generation": self.generation, "target_id": self.target}
        )

    async def packet(self, data):
        packet = decode_packet(data)
        if packet.generation != self.generation:
            return
        previous_capture = self.capture_times.get(packet.kind)
        if previous_capture is not None and packet.capture_time < previous_capture:
            raise ValueError("Capture clock moved backwards; restart capture")
        self.capture_times[packet.kind] = packet.capture_time
        if self.end_sample is not None and packet.kind != 2:
            return
        if packet.kind == 2:
            index = packet.sample_start + round(self.config.video_offset_ms * 16)
            timestamp = index / 16000

            retained_start = None
            if self.end_sample is None and self.buffer.start_sample is not None:
                retained_start = self.buffer.start_sample / 16000

            def observe():
                image = decode_frame(packet.payload)
                self.faces.detect(image, timestamp, retained_start)
                return image, self.faces.view()

            image, tracks = await self.loop.run_in_executor(self.executor, observe)
            # Camera observations use its capture clock; replay uses source seconds.
            if not self.target:
                cutoff = index - self.selection_frame_history
                while self.buffer.frames and self.buffer.frames[0][0] < cutoff:
                    self.buffer.frame_bytes -= self.buffer.frames.popleft()[1].nbytes
            if self.end_sample is None:
                try:
                    self.buffer.frame(index, image)
                except InputCapacityError:
                    self.overloaded()
                    return
            if timestamp - self.last_feed >= 0.18:
                self.put_reply({"type": "faces", "generation": self.generation, "tracks": tracks})
                self.last_feed = timestamp
            if self.end_sample is None and self.target and self.target not in self.faces.tracks:
                self.pause("Selected face was lost; select it again")
                return
        elif self.target and not self.paused:
            pcm = np.frombuffer(packet.payload, dtype="<f4").copy()
            try:
                self.buffer.audio(packet.sample_start, packet.capture_time, pcm)
            except InputCapacityError:
                self.overloaded()
                return
            self.accepted_end = packet.sample_start + pcm.size
        self.pump()

    def overloaded(self):
        if self.accepted_end is None:
            raise ValueError("Scene source capacity reached before any audio was accepted")
        self.end(self.accepted_end)
        self.flow(True, "device_cannot_keep_up")

    def pump(self):
        if not self.target or self.finishing:
            return
        while self.pending < 1:
            window = self.buffer.window(final=self.end_sample is not None)
            if window is None:
                break
            track = (
                self.drain_track
                if self.end_sample is not None
                else self.faces.tracks.get(self.target) or self.last_track
            )
            if track is None:
                self.pause("Selected face was lost; select it again")
                return
            copied = FaceTrack(track.id, list(track.observations), track.manual)
            self.last_track = copied
            generation = self.generation
            self.pending += 1
            try:
                self.owner.submit(
                    lambda w=window, t=copied, g=generation: self.infer(w, t, g), live=True
                )
            except ServiceError:
                self.pending -= 1
                raise
        if self.end_sample is not None and self.buffer.sample_count == 0 and self.pending == 0:
            self.finishing = True
            generation = self.generation
            end = self.end_sample
            self.owner.submit(lambda: self.drain(end, generation), live=True)

    def _processor(self, generation):
        if self.processor is None:
            self.processor = StreamProcessor(
                self.owner.separator, self.profile, noise_factory(self.owner.settings.noise)
            )
        if self.processor.generation != generation:
            self.processor.reset(generation)
        return self.processor

    def deliver(self, results, generation):
        for item in results:
            span = item.span
            self.post(
                {
                    "type": "audio",
                    "generation": generation,
                    "start_sample": span.start_sample,
                    "sample_count": span.pcm.size,
                    "sample_rate": 16000,
                    "capture_spans": [asdict(s) for s in item.captures],
                    "device": self.owner.separator.device,
                    "timings": item.timings,
                    "queued_windows": self.owner.queue.qsize(),
                    "pcm": base64.b64encode(span.pcm.astype("<f4").tobytes()).decode("ascii"),
                }
            )

    def infer(self, window, track, generation):
        try:
            if self.cancel.is_set() or generation != self.generation:
                return
            results = self._processor(generation).process(window, track, generation)
            if not self.cancel.is_set() and generation == self.generation:
                self.deliver(results, generation)
        except Exception as exc:
            self.post(
                {
                    "type": "error",
                    "code": "live_inference_failed",
                    "message": str(exc),
                    "generation": generation,
                }
            )
        finally:
            self.loop.call_soon_threadsafe(self.finished)

    def finished(self):
        self.pending -= 1
        if not self.cancel.is_set():
            try:
                self.pump()
            except Exception as exc:
                self.put_reply(
                    {
                        "type": "error",
                        "code": "live_input_failed",
                        "message": str(exc),
                        "generation": self.generation,
                    }
                )

    def end(self, source_end_sample):
        if self.end_sample is not None:
            return
        if source_end_sample is None or source_end_sample != self.accepted_end:
            raise ValueError("End sample does not match accepted source audio")
        track = self.faces.tracks.get(self.target) or self.last_track
        if track is not None:
            observations = [
                o for o in track.observations if o.timestamp <= source_end_sample / 16000
            ]
            self.drain_track = FaceTrack(track.id, observations, track.manual)
        self.end_sample = source_end_sample
        self.pump()

    def drain(self, end, generation):
        try:
            if self.cancel.is_set() or generation != self.generation:
                return
            self.deliver(self._processor(generation).finish(end), generation)
            self.post({"type": "drained", "generation": generation, "source_end_sample": end})
        except Exception as exc:
            self.post(
                {
                    "type": "error",
                    "code": "drain_failed",
                    "message": str(exc),
                    "generation": generation,
                }
            )

    async def close(self):
        self.cancel.set()
        self.generation += 1
        self.buffer.reset()
        try:
            await self.loop.run_in_executor(self.executor, self.faces.close)
        finally:
            try:
                await asyncio.to_thread(self.executor.shutdown, wait=True, cancel_futures=True)
            finally:
                await self.close_processor()

    async def close_processor(self):
        if self.processor:
            # Queue disposal behind all running inference so native state cannot race.
            if self.owner.thread.is_alive() and not self.owner.stopping.is_set():
                future = self.loop.create_future()

                def complete(error):
                    if not future.done():
                        if error is None:
                            future.set_result(None)
                        else:
                            future.set_exception(error)

                def dispose():
                    try:
                        self.processor.close()
                    except Exception as exc:
                        self.loop.call_soon_threadsafe(complete, exc)
                    else:
                        self.loop.call_soon_threadsafe(complete, None)

                while self.owner.queue.full():
                    await asyncio.sleep(0.02)
                self.owner.submit(dispose, live=True)
                await future
            else:
                self.processor.close()
