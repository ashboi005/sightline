"""Real WebSocket protocol tests; only the recognition model is replaced."""

import asyncio
import base64
import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
import websockets
from jsonschema import Draft202012Validator

from sign_service.server import make_handler, validate_command
from sign_service.types import Prediction

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft202012Validator(
    json.loads((ROOT / "packages/contracts/json-schema/sign-service.message.json").read_text())
)


class FakeRecognizer:
    model_name = "test"
    vocabulary = ["PLEASE", "A"]
    load_error = None

    def __init__(self):
        self.closed = False

    def reset(self):
        pass

    def close(self):
        self.closed = True

    def track(self, jpeg, ts):
        if jpeg == b"invalid":
            raise ValueError("invalid JPEG")
        return SimpleNamespace(
            hands_detected=int(jpeg != b"down"),
            partial=Prediction("PLEASE", 0.9, "SIGN") if jpeg != b"down" else None,
            observation=None,
        )


@pytest.mark.parametrize(
    "command",
    [
        {"type": []},
        {"type": {}},
        {
            "type": "stream.start",
            "protocolVersion": "1",
            "source": {},
            "fps": 12,
            "width": 640,
            "height": 480,
        },
        {"type": "frame", "seq": True, "image": "AA==", "ts": 0},
        {"type": "frame", "seq": 2**54, "image": "AA==", "ts": 0},
    ],
)
def test_malformed_commands_return_validation_failure(command):
    valid, _ = validate_command(command)
    assert not valid


async def receive(ws, kind, timeout=2):
    while True:
        message = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        VALIDATOR.validate(message)
        if message["type"] == kind:
            return message


async def start(ws, source="SELF"):
    await ws.send(
        json.dumps(
            dict(
                type="stream.start",
                protocolVersion="1",
                source=source,
                fps=12,
                width=640,
                height=480,
            )
        )
    )


async def frame(ws, seq, data=b"hand", age=0):
    await ws.send(
        json.dumps(
            dict(
                type="frame",
                seq=seq,
                image=base64.b64encode(data).decode(),
                ts=int(time.time() * 1000) - age,
            )
        )
    )
    await asyncio.sleep(0.015)


async def test_bad_commands_and_invalid_jpeg_do_not_disconnect():
    loop = asyncio.get_running_loop()
    tracked = asyncio.Queue()

    class RecoveryRecognizer(FakeRecognizer):
        def track(self, jpeg, ts):
            result = super().track(jpeg, ts)
            loop.call_soon_threadsafe(tracked.put_nowait, None)
            return result

    async with websockets.serve(make_handler(RecoveryRecognizer), "127.0.0.1", 0) as server:
        async with websockets.connect(
            f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        ) as ws:
            await receive(ws, "service.ready")
            await ws.send('{"type":[]}')
            assert (await receive(ws, "error"))["code"] == "BAD_MESSAGE"
            await start(ws)
            await frame(ws, 0, b"invalid")
            await receive(ws, "error")
            for i in range(1, 6):
                await frame(ws, i)
                # This tests recovery, not latest-frame dropping under a burst.
                await asyncio.wait_for(tracked.get(), 2)
            assert (await receive(ws, "sign.token"))["token"]["gloss"] == "PLEASE"


async def test_unavailable_model_never_announces_readiness():
    class Unavailable(FakeRecognizer):
        load_error = "missing CUDA"

    async with websockets.serve(make_handler(Unavailable), "127.0.0.1", 0) as server:
        async with websockets.connect(
            f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        ) as ws:
            message = json.loads(await ws.recv())
            VALIDATOR.validate(message)
            assert message["type"] == "error" and message["code"] == "MODEL_UNAVAILABLE"


async def test_status_is_throttled_even_when_hands_change():
    async with websockets.serve(make_handler(FakeRecognizer), "127.0.0.1", 0) as server:
        async with websockets.connect(
            f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        ) as ws:
            await receive(ws, "service.ready")
            await start(ws)
            for i in range(12):
                await frame(ws, i, b"down" if i % 2 else b"hand")
            statuses = []
            try:
                while True:
                    m = json.loads(await asyncio.wait_for(ws.recv(), 0.08))
                    VALIDATOR.validate(m)
                    if m["type"] == "hands.status":
                        statuses.append(m["ts"])
            except TimeoutError:
                pass
            assert statuses and all(b - a >= 195 for a, b in zip(statuses, statuses[1:]))


async def test_reset_is_responsive_during_tracking_and_discards_old_results():
    entered, release = threading.Event(), threading.Event()
    instance = FakeRecognizer()
    original = instance.track

    def blocked(jpeg, ts):
        entered.set()
        release.wait(2)
        return original(jpeg, ts)

    instance.track = blocked
    try:
        async with websockets.serve(make_handler(lambda: instance), "127.0.0.1", 0) as server:
            async with websockets.connect(
                f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
            ) as ws:
                await receive(ws, "service.ready")
                await start(ws)
                await frame(ws, 0)
                assert await asyncio.to_thread(entered.wait, 1)
                await ws.send('{"type":"phrase.reset"}')
                await ws.send("bad JSON")
                await receive(ws, "error", 0.25)
                release.set()
                await asyncio.sleep(0.05)
                await ws.send('{"type":"stream.stop"}')
                await frame(ws, 1)
                assert (await receive(ws, "error"))["code"] == "BAD_MESSAGE"
        assert instance.closed
    finally:
        release.set()


async def test_self_and_peer_streams_have_independent_phrase_state():
    async with websockets.serve(make_handler(FakeRecognizer), "127.0.0.1", 0) as server:
        url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        async with websockets.connect(url) as a, websockets.connect(url) as b:
            await receive(a, "service.ready")
            await receive(b, "service.ready")
            await start(a)
            await start(b, "PEER")
            for i in range(8):
                await frame(a, i)
            first = await receive(a, "sign.token")
            await b.send('{"type":"phrase.reset"}')
            for i in range(8):
                await frame(b, i)
            second = await receive(b, "sign.token")
            assert first["token"]["id"] != second["token"]["id"]
            await frame(a, 8, b"down")
            await asyncio.sleep(1.02)
            await frame(a, 9, b"down")
            assert (await receive(a, "phrase.end"))["tokenIds"] == [first["token"]["id"]]


async def test_stale_frames_are_ignored():
    async with websockets.serve(make_handler(FakeRecognizer), "127.0.0.1", 0) as server:
        async with websockets.connect(
            f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        ) as ws:
            await receive(ws, "service.ready")
            await start(ws)
            for i in range(5):
                await frame(ws, i, age=500)
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(ws.recv(), 0.08)


async def test_final_fresh_prediction_is_committed_after_hands_lower():
    from sign_service.scheduler import LatestInferenceScheduler
    from sign_service.types import RecognitionEvidence

    entered, release, lowered = threading.Event(), threading.Event(), threading.Event()

    class Delayed(FakeRecognizer):
        def __init__(self):
            super().__init__()
            self.seq = 0

        def track(self, jpeg, ts):
            if jpeg == b"down":
                lowered.set()
                return SimpleNamespace(hands_detected=0, partial=None, observation=None)
            self.seq += 1
            return SimpleNamespace(hands_detected=1, observation=self.seq)

        def predict(self, observation):
            if observation == 4:
                entered.set()
                release.wait(2)
            return RecognitionEvidence(Prediction("PLEASE", 0.9, "SIGN"), observation)

    scheduler = LatestInferenceScheduler()
    try:
        async with websockets.serve(make_handler(Delayed, scheduler), "127.0.0.1", 0) as server:
            async with websockets.connect(
                f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
            ) as ws:
                await receive(ws, "service.ready")
                await start(ws)
                for i in range(4):
                    await frame(ws, i)
                    await asyncio.sleep(0.04)
                assert await asyncio.to_thread(entered.wait, 1)
                await frame(ws, 4, b"down")
                assert await asyncio.to_thread(lowered.wait, 1)
                release.set()
                token = await receive(ws, "sign.token")
                await asyncio.sleep(1.02)
                await frame(ws, 5, b"down")
                assert (await receive(ws, "phrase.end"))["tokenIds"] == [token["token"]["id"]]
    finally:
        release.set()
        await scheduler.close()


async def test_phrase_end_cannot_overtake_tokens_under_backpressure():
    from sign_service.server import handle
    from sign_service.types import RecognitionEvidence

    class Model(FakeRecognizer):
        def __init__(self):
            super().__init__()
            self.frames = 0

        def track(self, jpeg, ts):
            self.frames += 1
            return SimpleNamespace(
                hands_detected=int(jpeg != b"down"), observation=(self.frames, jpeg)
            )

        def predict(self, observation):
            frame_id, jpeg = observation
            return RecognitionEvidence(
                Prediction(
                    "A" if jpeg == b"A" else "PLEASE",
                    0.9,
                    "FINGERSPELL" if jpeg == b"A" else "SIGN",
                ),
                frame_id,
            )

    model = Model()

    class Transport:
        def __init__(self):
            self.q = asyncio.Queue()
            self.sent = []
            self.ready = asyncio.Event()
            self.letter_accepted = asyncio.Event()
            self.blocked = asyncio.Event()
            self.release = asyncio.Event()

        def __aiter__(self):
            return self

        async def __anext__(self):
            message = await self.q.get()
            if message is None:
                raise StopAsyncIteration
            return message

        async def send(self, raw):
            message = json.loads(raw)
            VALIDATOR.validate(message)
            if message["type"] == "sign.token" and message["token"]["gloss"] == "A":
                self.blocked.set()
                await self.release.wait()
            self.sent.append(message)
            if message["type"] == "sign.partial" and message.get("acceptedGloss") == "A":
                self.letter_accepted.set()
            if message["type"] == "service.ready":
                self.ready.set()

        async def command(self, value):
            await self.q.put(json.dumps(value))
            await asyncio.sleep(0.03)

        async def frame(self, seq, value):
            await self.command(
                dict(
                    type="frame",
                    seq=seq,
                    image=base64.b64encode(value).decode(),
                    ts=int(time.time() * 1000),
                )
            )

    ws = Transport()
    task = asyncio.create_task(handle(ws, lambda: model))
    seq = 0

    async def hold_until(value, event):
        nonlocal seq
        # Latest-frame scheduling can discard superseded inputs. Wait for the
        # semantic transition rather than assuming a particular frame count.
        async with asyncio.timeout(5):
            while not event.is_set():
                await ws.frame(seq, value)
                seq += 1
                await asyncio.sleep(0.1)

    try:
        await asyncio.wait_for(ws.ready.wait(), 2)
        await ws.command(
            dict(
                type="stream.start",
                protocolVersion="1",
                source="SELF",
                fps=12,
                width=640,
                height=480,
            )
        )
        await hold_until(b"A", ws.letter_accepted)
        await hold_until(b"word", ws.blocked)
        await ws.frame(seq, b"down")
        seq += 1
        await asyncio.sleep(1.05)
        await ws.frame(seq, b"down")
        seq += 1
        ws.release.set()
        await asyncio.sleep(1.15)
        await ws.frame(seq, b"down")
        await asyncio.sleep(0.1)
    finally:
        ws.release.set()
        await ws.q.put(None)
        await asyncio.wait_for(task, 2)
    tokens = [(i, m["token"]) for i, m in enumerate(ws.sent) if m["type"] == "sign.token"]
    completions = [(i, m) for i, m in enumerate(ws.sent) if m["type"] == "phrase.end"]
    assert [token["gloss"] for _, token in tokens] == ["A", "PLEASE"]
    assert completions
    end_index, completion = completions[0]
    assert completion["tokenIds"] == [token["id"] for _, token in tokens]
    assert all(index < end_index for index, _ in tokens)


@pytest.mark.parametrize("command", ["phrase.reset", "stream.stop"])
async def test_control_during_gpu_inference_fences_results_and_allows_new_phrase(command):
    from sign_service.scheduler import LatestInferenceScheduler
    from sign_service.types import RecognitionEvidence

    entered, release = threading.Event(), threading.Event()
    loop = asyncio.get_running_loop()
    predicted = asyncio.Queue()

    class Delayed(FakeRecognizer):
        def __init__(self):
            super().__init__()
            self.frames = 0

        def track(self, jpeg, ts):
            self.frames += 1
            return SimpleNamespace(hands_detected=1, observation=self.frames)

        def predict(self, observation):
            if observation == 4:
                entered.set()
                release.wait(2)
            loop.call_soon_threadsafe(predicted.put_nowait, observation)
            return RecognitionEvidence(Prediction("PLEASE", 0.9, "SIGN"), observation)

    scheduler = LatestInferenceScheduler()
    try:
        async with websockets.serve(make_handler(Delayed, scheduler), "127.0.0.1", 0) as server:
            async with websockets.connect(
                f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
            ) as ws:
                await receive(ws, "service.ready")
                await start(ws)
                for seq in range(4):
                    await frame(ws, seq)
                    await asyncio.sleep(0.03)
                assert await asyncio.to_thread(entered.wait, 1)
                await ws.send(json.dumps({"type": command}))
                await ws.send("malformed JSON")
                await receive(ws, "error", 0.25)
                release.set()
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(ws.recv(), 0.1)
                if command == "stream.stop":
                    await frame(ws, 4)
                    assert (await receive(ws, "error"))["code"] == "BAD_MESSAGE"
                    await start(ws)
                for seq in range(5, 13):
                    await frame(ws, seq)
                    # Verify recovery, not survival of a burst in a latest-frame queue.
                    while await asyncio.wait_for(predicted.get(), 2) <= 4:
                        pass
                token = await receive(ws, "sign.token")
                assert token["token"]["gloss"] == "PLEASE"
    finally:
        release.set()
        await scheduler.close()


async def test_tracker_initialization_failure_reports_unavailability():
    def unavailable():
        raise RuntimeError("tracker initialization failed")

    async with websockets.serve(make_handler(unavailable), "127.0.0.1", 0) as server:
        async with websockets.connect(
            f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        ) as ws:
            message = json.loads(await ws.recv())
            VALIDATOR.validate(message)
            assert message["type"] == "error"
            assert message["code"] == "MODEL_UNAVAILABLE"
            assert "tracker initialization failed" in message["message"]
            await ws.send('{"type":[]}')
            assert (await receive(ws, "error"))["code"] == "BAD_MESSAGE"


async def test_negotiated_one_fps_can_accept_a_steady_letter():
    class SlowAlphabet(FakeRecognizer):
        def track(self, jpeg, ts):
            return SimpleNamespace(
                hands_detected=1, partial=Prediction("A", 0.9, "FINGERSPELL"),
                observation=None,
            )

    async with websockets.serve(make_handler(SlowAlphabet), "127.0.0.1", 0) as server:
        async with websockets.connect(
            f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        ) as ws:
            await receive(ws, "service.ready")
            await ws.send(json.dumps(dict(
                type="stream.start", protocolVersion="1", source="SELF",
                fps=1, width=640, height=480,
            )))
            for seq in range(4):
                await frame(ws, seq)
                if seq < 3:
                    await asyncio.sleep(1)
            accepted = None
            while accepted != "A":
                partial = await receive(ws, "sign.partial", timeout=1)
                accepted = partial.get("acceptedGloss")
            assert accepted == "A"

async def test_tunnel_frame_age_allowance_accepts_network_delay_but_rejects_old_frames(monkeypatch):
    monkeypatch.setenv("SIGN_SERVICE_MAX_FRAME_AGE_MS", "1000")
    tracked = []

    class Recorder(FakeRecognizer):
        def track(self, jpeg, ts):
            tracked.append(jpeg)
            return super().track(jpeg, ts)

    async with websockets.serve(make_handler(Recorder), "127.0.0.1", 0) as server:
        async with websockets.connect(
            f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/ws"
        ) as ws:
            await receive(ws, "service.ready")
            await start(ws)
            await frame(ws, 0, age=500)
            status = await receive(ws, "hands.status", timeout=.5)
            assert status["handsDetected"] == 1
            assert tracked == [b"hand"]
            await frame(ws, 1, b"too-old", age=1500)
            await ws.send("not JSON")
            await receive(ws, "error")
            assert tracked == [b"hand"]
