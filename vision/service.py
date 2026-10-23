"""Authenticated loopback-only image inference. Never loads URLs or writes frames."""

import base64
import hmac
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from PIL import Image

MAX_BODY = 2 * 1024 * 1024


def decode_image(value):
    if not isinstance(value, str) or not value or len(value) > MAX_BODY:
        raise ValueError("Invalid camera image.")
    try:
        data = base64.b64decode(value, validate=True)
        with Image.open(io.BytesIO(data)) as header:
            width, height = header.size
            if (
                header.format != "JPEG"
                or not 1 <= width <= 1280
                or not 1 <= height <= 1280
                or width * height > 2_000_000
            ):
                raise ValueError("Camera image exceeds the supported size.")
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Invalid camera image.")
        return image
    except (OSError, TypeError, base64.binascii.Error) as error:
        raise ValueError("Invalid camera image.") from error


class LoadingEngine:
    def __init__(self):
        self.engine = None
        self.error = None
        threading.Thread(target=self.load, daemon=True).start()

    def load(self):
        try:
            from engine import VisionEngine

            self.engine = VisionEngine()
        except Exception:
            self.error = (
                "Tracking unavailable. Run the vision setup command and restart the server."
            )

    def status(self):
        if self.error:
            return {"status": "error", "error": self.error}
        return self.engine.status() if self.engine else {"status": "loading"}

    def ready(self):
        if self.engine is None:
            raise RuntimeError(self.error or "Vision is warming up. Retry Select in a moment.")
        return self.engine

    def select(self, *args, **kwargs):
        return self.ready().select(*args, **kwargs)

    def track(self, *args):
        return self.ready().track(*args)

    def match(self, *args):
        return self.ready().match(*args)

    def clear(self, *args):
        if self.engine:
            self.engine.clear(*args)

    def expire(self):
        if self.engine:
            self.engine.expire()


def create_server(engine, secret):
    if not secret:
        raise ValueError("A local service secret is required.")
    gate = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, result):
            data = json.dumps(result, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            self.connection.settimeout(10)
            if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {secret}"):
                return self.reply(401, {"error": "Unauthorized local vision request."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.reply(400, {"error": "Invalid request size."})
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {"error": "Camera request is too large."})
            if self.headers.get("Content-Type") != "application/json":
                return self.reply(400, {"error": "Expected JSON."})
            if not gate.acquire(blocking=False):
                return self.reply(429, {"error": "Vision is busy. Retry in a moment."})
            try:
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise TypeError("Invalid camera request.")
                action = body.get("action")
                if action == "status":
                    result = engine.status()
                elif action == "select":
                    arguments = (
                        decode_image(body.get("image")),
                        body.get("point"),
                        body.get("box"),
                    )
                    kind = body.get("kind", "object")
                    if kind not in ("object", "person"):
                        raise ValueError("Unknown selection type.")
                    result = (
                        engine.select(*arguments, kind=kind)
                        if kind == "person"
                        else engine.select(*arguments)
                    )
                elif action in ("match", "track", "clear"):
                    token = body.get("token")
                    if not isinstance(token, str) or not 1 <= len(token) <= 64:
                        raise ValueError("Select an object first.")
                    if action == "match":
                        stream = body.get("stream", 0)
                        if (
                            not isinstance(stream, int)
                            or isinstance(stream, bool)
                            or not 0 <= stream <= 1_000_000
                        ):
                            raise ValueError("Invalid camera stream revision.")
                        result = engine.match(token, decode_image(body.get("image")), stream)
                    elif action == "track":
                        result = engine.track(token, decode_image(body.get("image")))
                    else:
                        engine.clear(token)
                        result = {"status": "cleared"}
                else:
                    raise ValueError("Unknown vision action.")
                self.reply(200, result)
            except (ValueError, TypeError, OSError) as error:
                self.reply(400, {"error": str(error)})
            except KeyError:
                self.reply(410, {"error": "Selection expired. Select the object again."})
            except RuntimeError as error:
                self.reply(503, {"error": str(error)})
            except Exception:
                self.reply(500, {"error": "Vision could not process this frame. Retry Select."})
            finally:
                gate.release()

    class VisionServer(ThreadingHTTPServer):
        def service_actions(self):
            if gate.acquire(blocking=False):
                try:
                    expire = getattr(engine, "expire", None)
                    if expire:
                        expire()
                finally:
                    gate.release()

    return VisionServer(("127.0.0.1", 0), Handler)


if __name__ == "__main__":
    server = create_server(LoadingEngine(), os.environ.get("GAZE_VISION_SECRET"))
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever(poll_interval=0.25)
