"""Standalone webcam client for exercising the sign service without the web UI.

Run from ``apps/sign-service``::

    python -m sign_service.camera_client

The camera preview is mirrored for comfortable use, but transmitted frames are
not mirrored, matching the sign-service contract.  Press ``q`` or Escape to
quit, ``r`` to reset the current phrase, and ``s`` to stop/start the stream.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import queue
import threading
import time
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

try:
    from websockets.asyncio.client import connect
except ImportError:  # websockets 13 compatibility
    from websockets import connect  # type: ignore

from .model import LandmarkExtractor


PROTOCOL_VERSION = "1"


def now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass(frozen=True)
class CameraFrame:
    jpeg: bytes
    width: int
    height: int


class CameraCapture:
    """OpenCV capture thread with a bounded latest-frame buffer."""

    def __init__(self, camera: int, width: int, height: int, jpeg_quality: int, draw_landmarks: bool = True) -> None:
        self.camera = camera
        self.width = width
        self.height = height
        self.jpeg_quality = jpeg_quality
        self.draw_landmarks = draw_landmarks
        self.stop_event = threading.Event()
        self.ready_event = threading.Event()
        self.control_commands: queue.Queue[str] = queue.Queue()
        self._frame_lock = threading.Lock()
        self._latest_frame: CameraFrame | None = None
        self._overlay_lock = threading.Lock()
        self._overlay: list[str] = ["Starting camera..."]
        self._thread: threading.Thread | None = None
        self.error: str | None = None
        self.quit_requested = False

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="sign-camera", daemon=True)
        self._thread.start()

    def join(self, timeout: float | None = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout)

    def request_quit(self) -> None:
        self.quit_requested = True
        self.stop_event.set()

    def set_overlay(self, lines: list[str]) -> None:
        with self._overlay_lock:
            self._overlay = lines[:8]

    def latest_frame(self) -> CameraFrame | None:
        with self._frame_lock:
            return self._latest_frame

    def pop_commands(self) -> list[str]:
        commands: list[str] = []
        while True:
            try:
                commands.append(self.control_commands.get_nowait())
            except queue.Empty:
                return commands

    def _run(self) -> None:
        extractor = LandmarkExtractor(static_image_mode=False) if self.draw_landmarks else None
        capture = cv2.VideoCapture(self.camera, cv2.CAP_DSHOW)
        if not capture.isOpened():
            # CAP_DSHOW is not available or does not work for every camera.
            capture.release()
            capture = cv2.VideoCapture(self.camera)
        if not capture.isOpened():
            self.error = f"could not open camera index {self.camera}"
            self.ready_event.set()
            self.stop_event.set()
            if extractor is not None:
                extractor.close()
            return

        capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        try:
            while not self.stop_event.is_set():
                ok, frame = capture.read()
                if not ok or frame is None:
                    self.error = "camera returned an empty frame"
                    self.stop_event.set()
                    break

                local_hands = 0
                if extractor is not None and extractor.available:
                    _, local_hands = extractor.extract(frame)

                actual_height, actual_width = frame.shape[:2]
                if actual_width != self.width or actual_height != self.height:
                    frame = cv2.resize(frame, (self.width, self.height), interpolation=cv2.INTER_AREA)
                    actual_height, actual_width = frame.shape[:2]
                ok, encoded = cv2.imencode(
                    ".jpg",
                    frame,
                    [cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality],
                )
                if not ok:
                    self.error = "OpenCV could not encode a camera frame as JPEG"
                    self.stop_event.set()
                    break

                with self._frame_lock:
                    self._latest_frame = CameraFrame(encoded.tobytes(), actual_width, actual_height)
                self.ready_event.set()

                with self._overlay_lock:
                    overlay = list(self._overlay)
                preview = extractor.draw_last_landmarks(frame) if extractor is not None and extractor.available else frame.copy()
                preview = cv2.flip(preview, 1)
                overlay.insert(1, f"camera hands: {local_hands}")
                for index, line in enumerate(overlay):
                    cv2.putText(
                        preview,
                        line,
                        (12, 28 + index * 24),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.62,
                        (0, 230, 0) if index == 0 else (255, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )
                cv2.imshow("Sightline sign-service camera", preview)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
                    self.request_quit()
                    break
                if key == ord("r"):
                    self.control_commands.put("reset")
                if key == ord("s"):
                    self.control_commands.put("toggle")
        finally:
            capture.release()
            cv2.destroyAllWindows()
            if extractor is not None:
                extractor.close()


class CameraClient:
    def __init__(
        self,
        url: str,
        camera: int,
        fps: int,
        width: int,
        height: int,
        source: str,
        jpeg_quality: int,
    ) -> None:
        self.url = url
        self.fps = fps
        self.source = source
        self.capture = CameraCapture(camera, width, height, jpeg_quality)
        self.sequence = 0
        self.streaming = False
        self.last_hands = "?"
        self.last_partial = "-"
        self.tokens: list[str] = []
        self.last_phrase = "-"
        self.last_error = "-"
        self._message_lock = threading.Lock()

    async def send_start(self, ws: Any) -> None:
        frame = self.capture.latest_frame()
        width = frame.width if frame else self.capture.width
        height = frame.height if frame else self.capture.height
        await ws.send(json.dumps({
            "type": "stream.start",
            "protocolVersion": PROTOCOL_VERSION,
            "source": self.source,
            "fps": self.fps,
            "width": width,
            "height": height,
        }, separators=(",", ":")))
        self.streaming = True

    async def send_stop(self, ws: Any) -> None:
        if self.streaming:
            await ws.send(json.dumps({"type": "stream.stop"}))
            self.streaming = False

    async def receiver(self, ws: Any) -> None:
        try:
            async for raw in ws:
                message = json.loads(raw)
                self._handle_message(message)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.last_error = f"receiver: {exc}"
            self.capture.set_overlay(self.overlay_lines())
            self.capture.stop_event.set()

    def _handle_message(self, message: dict[str, Any]) -> None:
        message_type = message.get("type")
        with self._message_lock:
            if message_type == "hands.status":
                self.last_hands = str(message.get("handsDetected", "?"))
            elif message_type == "sign.partial":
                self.last_partial = f"{message.get('gloss', '?')} ({message.get('confidence', 0):.2f})"
                print(f"[partial] {self.last_partial}")
            elif message_type == "sign.token":
                token = message.get("token", {})
                gloss = str(token.get("gloss", "?"))
                self.tokens.append(gloss)
                self.tokens = self.tokens[-8:]
                print(f"[token] {gloss} confidence={token.get('confidence', 0):.2f}")
            elif message_type == "phrase.end":
                self.last_phrase = " ".join(self.tokens) or "(empty)"
                print(f"[phrase.end] {self.last_phrase}")
                self.tokens.clear()
            elif message_type == "error":
                self.last_error = f"{message.get('code', 'ERROR')}: {message.get('message', '')}"
                print(f"[error] {self.last_error}")
            elif message_type == "service.ready":
                vocabulary = message.get("vocabulary", [])
                print(f"[ready] model={message.get('model')} vocabulary={len(vocabulary)}")
        self.capture.set_overlay(self.overlay_lines())

    def overlay_lines(self) -> list[str]:
        with self._message_lock:
            return [
                f"hands: {self.last_hands}  streaming: {'ON' if self.streaming else 'OFF'}",
                f"partial: {self.last_partial}",
                f"tokens: {' '.join(self.tokens[-5:]) or '-'}",
                f"last phrase: {self.last_phrase}",
                f"error: {self.last_error}",
                "[r] reset  [s] stop/start  [q] quit",
            ]

    async def sender(self, ws: Any) -> None:
        interval = 1.0 / self.fps
        next_send = time.monotonic()
        try:
            while not self.capture.stop_event.is_set():
                for command in self.capture.pop_commands():
                    if command == "reset":
                        await ws.send(json.dumps({"type": "phrase.reset"}))
                        self.tokens.clear()
                        self.last_phrase = "-"
                        self.last_partial = "-"
                        self.capture.set_overlay(self.overlay_lines())
                        print("[client] phrase reset")
                    elif command == "toggle":
                        if self.streaming:
                            await self.send_stop(ws)
                            print("[client] stream stopped")
                        else:
                            await self.send_start(ws)
                            print("[client] stream started")

                now = time.monotonic()
                if now < next_send:
                    await asyncio.sleep(min(next_send - now, 0.02))
                    continue
                next_send = max(next_send + interval, now)

                if not self.streaming:
                    continue
                frame = self.capture.latest_frame()
                if frame is None:
                    continue
                timestamp = now_ms()
                payload = {
                    "type": "frame",
                    "seq": self.sequence,
                    "image": base64.b64encode(frame.jpeg).decode("ascii"),
                    "ts": timestamp,
                }
                self.sequence += 1
                await ws.send(json.dumps(payload, separators=(",", ":")))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.last_error = f"sender: {exc}"
            self.capture.set_overlay(self.overlay_lines())
            self.capture.stop_event.set()
        finally:
            if self.streaming:
                try:
                    await self.send_stop(ws)
                except Exception:
                    pass

    async def run(self) -> None:
        print(f"Connecting to {self.url}")
        async with connect(self.url, max_size=4 * 1024 * 1024, open_timeout=10) as ws:
            raw_ready = await asyncio.wait_for(ws.recv(), timeout=10)
            ready = json.loads(raw_ready)
            if ready.get("type") != "service.ready":
                raise RuntimeError(f"expected service.ready, received {ready.get('type')!r}")
            self._handle_message(ready)

            self.capture.start()
            if not await asyncio.to_thread(self.capture.ready_event.wait, 10):
                raise RuntimeError(self.capture.error or "camera did not produce a frame within 10 seconds")
            if self.capture.error:
                raise RuntimeError(self.capture.error)

            await self.send_start(ws)
            print("Camera streaming started. Press q/Escape to quit, r to reset, s to stop/start.")
            receiver_task = asyncio.create_task(self.receiver(ws))
            sender_task = asyncio.create_task(self.sender(ws))
            try:
                await asyncio.to_thread(self.capture.stop_event.wait)
            finally:
                if not sender_task.done():
                    await sender_task
                receiver_task.cancel()
                await asyncio.gather(receiver_task, return_exceptions=True)

        self.capture.join(2)
        if self.capture.error:
            raise RuntimeError(self.capture.error)


async def async_main(args: argparse.Namespace) -> None:
    client = CameraClient(
        url=args.url,
        camera=args.camera,
        fps=args.fps,
        width=args.width,
        height=args.height,
        source=args.source,
        jpeg_quality=args.jpeg_quality,
    )
    try:
        await client.run()
    except KeyboardInterrupt:
        client.capture.request_quit()
    finally:
        client.capture.request_quit()
        client.capture.join(2)


def main() -> None:
    parser = argparse.ArgumentParser(description="View sign-service recognition from a local webcam")
    parser.add_argument("--url", default="ws://localhost:7788/ws", help="sign service WebSocket URL")
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index")
    parser.add_argument("--fps", type=int, choices=range(1, 31), default=12, help="frames per second")
    parser.add_argument("--width", type=int, default=640, help="requested camera width")
    parser.add_argument("--height", type=int, default=480, help="requested camera height")
    parser.add_argument("--source", choices=("SELF", "PEER"), default="SELF")
    parser.add_argument("--jpeg-quality", type=int, choices=range(40, 101), default=82)
    args = parser.parse_args()
    if args.width <= 0 or args.height <= 0:
        parser.error("--width and --height must be positive")
    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        parser.exit(1, f"camera client error: {exc}\n")


if __name__ == "__main__":
    main()
