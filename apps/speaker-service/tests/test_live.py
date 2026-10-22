import asyncio
from time import monotonic
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from sightline_speaker.api import create_app
from sightline_speaker.jobs import ServiceError, Store
from sightline_speaker.live import LiveConfig, LiveSession, TargetConfig
from sightline_speaker.live_faces import decode_frame
from sightline_speaker.settings import Settings
from sightline_speaker.stream_protocol import encode_packet


def config(**changes):
    data = dict(
        type="configure",
        protocol_version=3,
        sample_rate=16000,
        audio=True,
        source="replay",
        sync_verified=True,
        video_offset_ms=0,
        client_time=monotonic(),
    )
    data.update(changes)
    return data


@pytest.mark.parametrize(
    "changes",
    [
        {"protocol_version": 1},
        {"audio": False},
        {"sync_verified": False},
        {"sample_rate": 48000},
        {"source": "unknown"},
        {"video_offset_ms": float("inf")},
    ],
)
def test_configuration_rejects_obsolete_or_unsafe_inputs(changes):
    with pytest.raises(ValidationError):
        LiveConfig.model_validate(config(**changes))


def test_stream_owner_reserves_worker_from_batch_jobs(tmp_path):
    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    store.live_lock.acquire()
    try:
        with pytest.raises(ServiceError, match="live"):
            store.submit(lambda: None)
        store.submit(lambda: None, live=True)
        assert store.queue.qsize() == 1
    finally:
        store.live_lock.release()
        store.close()


@pytest.mark.parametrize("source", ["camera", "network", "replay"])
def test_origin_ready_heartbeat_and_reconnect_beyond_clip_limit(tmp_path, monkeypatch, source):
    monkeypatch.setattr("sightline_speaker.live_faces.LiveFaces.initialize", lambda _: None)
    settings = Settings(data_dir=tmp_path, max_duration=0.001)
    store = Store(settings, start_worker=False, load_model=False)
    store.separator = SimpleNamespace(device="cpu", engine_key="rtfs")
    store.model_state = "ready"
    store.streaming_ready = True
    store.warm_timings = [0.1, 0.2, 0.15]
    with TestClient(create_app(settings, store), base_url="http://127.0.0.1") as client:
        for _ in range(2):
            with client.websocket_connect(
                "ws://127.0.0.1/live", headers={"origin": settings.origin}
            ) as socket:
                socket.send_json(config(source=source, video_offset_ms=-250))
                ready = socket.receive_json()
                assert ready.get("protocol_version") == 3, ready
                assert "playout_seconds" not in ready
                socket.send_json({"type": "pause"})
                socket.send_json({"type": "heartbeat"})
                socket.send_json({"type": "target", "generation": 1, "target_id": None})
                assert socket.receive_json()["type"] == "selected"
                socket.send_json({"type": "stop"})
                from starlette.websockets import WebSocketDisconnect

                with pytest.raises(WebSocketDisconnect):
                    socket.receive_json()
        assert not store.live_lock.locked()


@pytest.mark.asyncio
async def test_backwards_capture_is_rejected_but_paused_source_time_is_valid(tmp_path):
    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config()))
    session.generation = 1
    session.target = "face"
    try:
        pcm = np.zeros(1600, dtype="<f4").tobytes()
        await session.packet(encode_packet(1, 1, 0, monotonic(), pcm))
        # A later capture clock is valid even though the source position only advances 100 ms.
        await session.packet(encode_packet(1, 1, 1600, monotonic() + 0.4, pcm))
        with pytest.raises(ValueError, match="clock"):
            await session.packet(encode_packet(1, 1, 3200, monotonic() - 2, pcm))
    finally:
        await session.close()
        store.close()


@pytest.mark.asyncio
async def test_generation_change_discards_late_worker_result(tmp_path):
    from sightline_speaker.faces import FaceTrack

    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config()))
    try:
        session.faces.tracks["face"] = FaceTrack("face")
        session.select(TargetConfig(type="target", generation=1, target_id="face"))
        session.pending = 1
        session.select(TargetConfig(type="target", generation=2, target_id=None))
        session.infer(None, None, 1)
        await asyncio.sleep(0)
        assert all(
            session.replies.get_nowait()["type"] == "selected"
            for _ in range(session.replies.qsize())
        )
        assert session.pending == 0
    finally:
        await session.close()
        store.close()


def test_jpeg_bomb_rejected_before_decode():
    from io import BytesIO

    from PIL import Image

    data = BytesIO()
    Image.new("RGB", (641, 16)).save(data, format="JPEG")
    with pytest.raises(ValueError, match="dimensions"):
        decode_frame(data.getvalue())


@pytest.mark.asyncio
async def test_final_drain_delivers_every_accepted_sample_with_bounded_queue(tmp_path, monkeypatch):
    from test_noise import IdentityNative

    from sightline_speaker.faces import FaceTrack
    from sightline_speaker.noise import NoiseSuppressor
    from sightline_speaker.stream_processor import StreamProcessor

    monkeypatch.setattr(
        "sightline_speaker.stream_processor.prepare_frames",
        lambda *_: np.zeros((50, 88, 88), np.float32),
    )
    owner = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    owner.separator = SimpleNamespace(
        device="cpu", engine_key="rtfs", extract=lambda audio, _: audio
    )
    session = LiveSession(owner, LiveConfig.model_validate(config()))
    session.faces.tracks["face"] = FaceTrack("face")
    session.select(TargetConfig(type="target", generation=1, target_id="face"))
    session.processor = StreamProcessor(
        owner.separator,
        session.profile,
        noise_factory=lambda: NoiseSuppressor(native_factory=IdentityNative),
    )
    session.processor.reset(1)
    size = 39017
    for start in range(0, size, 1600):
        session.buffer.frame(start, np.zeros((8, 8, 3), np.uint8))
        count = min(1600, size - start)
        session.buffer.audio(start, monotonic(), np.full(count, 0.2, np.float32))
    session.accepted_end = size
    session.end(size)
    assert session.pending <= 2
    delivered = []
    try:
        for _ in range(12):
            while not owner.queue.empty():
                owner.queue.get_nowait()()
                owner.queue.task_done()
                await asyncio.sleep(0)
                assert session.pending <= 2
            await asyncio.sleep(0)
            while not session.replies.empty():
                delivered.append(session.replies.get_nowait())
            if any(r["type"] == "drained" for r in delivered):
                break
        assert sum(r["sample_count"] for r in delivered if r["type"] == "audio") == size
        assert delivered[-1]["type"] == "drained"
    finally:
        await session.close()
        owner.close()


def test_stream_warmup_excludes_cold_call_and_preserves_file_capability_on_failure(tmp_path):
    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    calls = []
    store.separator = SimpleNamespace(extract=lambda audio, frames: calls.append((audio, frames)))
    store._warm_streaming()
    assert len(calls) == 14
    assert {call[0].size for call in calls} == {1920, *range(3200, 32001, 3200)}
    assert np.any(calls[0][0] != 0)
    assert len(store.warm_timings) == 3
    assert store.streaming_ready
    store.streaming_ready = False

    def failed(*_):
        raise RuntimeError("device unavailable")

    store.separator.extract = failed
    store._warm_streaming()
    assert not store.streaming_ready
    assert store.separator is not None
    assert "device unavailable" in store.streaming_error
    store.close()


@pytest.mark.asyncio
async def test_face_discovery_without_target_does_not_accumulate_full_scene_frames(
    tmp_path, monkeypatch
):
    owner = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(owner, LiveConfig.model_validate(config()))
    monkeypatch.setattr(
        "sightline_speaker.live_session.decode_frame", lambda _: np.zeros((480, 640, 3), np.uint8)
    )
    monkeypatch.setattr(session.faces, "detect", lambda *_: None)
    monkeypatch.setattr(session.faces, "view", lambda: [])
    try:
        now = monotonic()
        for index in range(160):
            await session.packet(encode_packet(2, 0, index * 1600, now, b"jpeg"))
            while not session.replies.empty():
                session.replies.get_nowait()
        assert len(session.buffer.frames) <= 1
    finally:
        await session.close()
        owner.close()


@pytest.mark.asyncio
async def test_replay_rewind_reacquires_faces_without_future_observations(tmp_path):
    from sightline_speaker.faces import FaceTrack

    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config()))
    session.faces.tracks["future-face"] = FaceTrack("future-face")
    session.faces.last_detection = 9
    session.last_feed = 9
    try:
        session.select(
            TargetConfig(type="target", generation=1, target_id=None, replay_start_sample=16000)
        )
        assert session.faces.tracks == {}
        assert session.faces.last_detection == -1
        assert session.last_feed == -1
        assert session.buffer.sample_count == 0
    finally:
        await session.close()
        store.close()


def test_health_reports_the_active_model_stream_profile(tmp_path):
    store = Store(
        Settings(data_dir=tmp_path, engine="av-mossformer2"), start_worker=False, load_model=False
    )
    try:
        health = store.health()
        assert health.window_seconds == 3
        assert health.stride_seconds == 1.8
    finally:
        store.close()


def test_batch_enqueue_and_live_admission_cannot_interleave(tmp_path, monkeypatch):
    import threading

    monkeypatch.setattr("sightline_speaker.live_faces.LiveFaces.initialize", lambda _: None)
    settings = Settings(data_dir=tmp_path)
    store = Store(settings, start_worker=False, load_model=False)
    store.separator = SimpleNamespace(device="cpu", engine_key="rtfs")
    store.model_state = "ready"
    store.streaming_ready = True
    entered, release = threading.Event(), threading.Event()
    original_put = store.queue.put_nowait

    def delayed_put(task):
        entered.set()
        assert release.wait(3)
        original_put(task)

    monkeypatch.setattr(store.queue, "put_nowait", delayed_put)
    batch = threading.Thread(target=lambda: store.submit(lambda: None))
    batch.start()
    assert entered.wait(2)
    try:
        with TestClient(create_app(settings, store), base_url="http://127.0.0.1") as client:
            with client.websocket_connect(
                "ws://127.0.0.1/live", headers={"origin": settings.origin}
            ) as socket:
                socket.send_json(config())
                reply = socket.receive_json()
                assert reply.get("code") == "live_busy", reply
    finally:
        release.set()
        batch.join(3)
        store.close()


def test_live_admission_rejects_a_dequeued_unfinished_batch_task(tmp_path, monkeypatch):
    monkeypatch.setattr("sightline_speaker.live_faces.LiveFaces.initialize", lambda _: None)
    settings = Settings(data_dir=tmp_path)
    store = Store(settings, start_worker=False, load_model=False)
    store.separator = SimpleNamespace(device="cpu", engine_key="rtfs")
    store.model_state = "ready"
    store.streaming_ready = True
    store.submit(lambda: None)
    store.queue.get_nowait()
    assert store.queue.empty()
    try:
        with TestClient(create_app(settings, store), base_url="http://127.0.0.1") as client:
            with client.websocket_connect(
                "ws://127.0.0.1/live", headers={"origin": settings.origin}
            ) as socket:
                socket.send_json(config())
                reply = socket.receive_json()
                assert reply.get("code") == "worker_busy", reply
    finally:
        store.queue.task_done()
        store.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["replay", "camera"])
async def test_delayed_contiguous_capture_is_accepted_without_an_arrival_deadline(tmp_path, source):
    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config(source=source)))
    session.generation = 1
    session.target = "face"
    try:
        captured = monotonic() - 3
        pcm = np.zeros(1600, dtype="<f4").tobytes()
        await session.packet(encode_packet(1, 1, 0, captured, pcm))
        await session.packet(encode_packet(1, 1, 1600, captured + 0.1, pcm))
        assert session.buffer.next_audio == 3200
        assert session.accepted_end == 3200
    finally:
        await session.close()
        store.close()


@pytest.mark.asyncio
async def test_native_processor_close_failure_does_not_leave_session_cleanup_waiting(tmp_path):
    store = Store(Settings(data_dir=tmp_path), load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config()))

    def failed_close():
        raise RuntimeError("native cleanup failed")

    session.processor = SimpleNamespace(close=failed_close)
    try:
        with pytest.raises(RuntimeError, match="native cleanup failed"):
            await asyncio.wait_for(session.close(), 1)
        assert session.cancel.is_set()
        assert not session.executor._threads or all(
            not t.is_alive() for t in session.executor._threads
        )
    finally:
        store.close()


@pytest.mark.asyncio
async def test_failed_face_cleanup_releases_the_disconnected_sessions_processing_lease(
    tmp_path, monkeypatch
):
    from sightline_speaker.live import serve_live

    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    store.separator = SimpleNamespace(device="cpu", engine_key="rtfs")
    store.model_state = "ready"
    store.streaming_ready = True
    monkeypatch.setattr("sightline_speaker.live_faces.LiveFaces.initialize", lambda _: None)

    def failed_close(_):
        raise RuntimeError("face cleanup failed")

    monkeypatch.setattr("sightline_speaker.live_faces.LiveFaces.close", failed_close)

    try:
        with pytest.raises(RuntimeError, match="face cleanup failed"):
            await serve_live(DisconnectedSocket(store))
        assert not store.live_lock.locked()
    finally:
        store.close()


class DisconnectedSocket:
    def __init__(self, store):
        self.app = SimpleNamespace(state=SimpleNamespace(store=store))
        self.headers = {"host": "127.0.0.1", "origin": store.settings.origin}

    async def accept(self):
        pass

    async def receive_text(self):
        import json

        return json.dumps(config())

    async def receive(self):
        return {"type": "websocket.disconnect"}

    async def send_json(self, reply):
        pass

    async def close(self, code=1000):
        pass


@pytest.mark.asyncio
async def test_transport_cancellation_holds_the_lease_until_native_cleanup_finishes(
    tmp_path, monkeypatch
):
    from sightline_speaker.live import serve_live

    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    store.separator = SimpleNamespace(device="cpu", engine_key="rtfs")
    store.model_state = "ready"
    store.streaming_ready = True
    monkeypatch.setattr("sightline_speaker.live_faces.LiveFaces.initialize", lambda _: None)
    entered, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
    close = LiveSession.close
    sessions = []

    async def delayed_close(session):
        sessions.append(session)
        entered.set()
        await release.wait()
        await close(session)
        finished.set()

    monkeypatch.setattr(LiveSession, "close", delayed_close)
    task = asyncio.create_task(serve_live(DisconnectedSocket(store)))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert store.live_lock.locked()
        release.set()
        await asyncio.wait_for(finished.wait(), 1)
        assert not store.live_lock.locked()
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
        if not finished.is_set() and sessions:
            await close(sessions[0])
        store.close()


@pytest.mark.asyncio
async def test_live_batches_only_available_input_without_pausing_capture(tmp_path):
    from sightline_speaker.faces import FaceTrack

    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config()))
    session.faces.tracks["face"] = FaceTrack("face")
    session.select(TargetConfig(type="target", generation=1, target_id="face"))
    try:
        for start in [0, 1920, 3840]:
            for sample in range(start, start + 1920, 640):
                session.buffer.frame(sample, np.zeros((8, 8, 3), np.uint8))
            session.buffer.audio(start, 10 + start / 16000, np.zeros(1920, np.float32))
            session.pump()
        assert session.pending == 1
        assert store.queue.qsize() == 1
        assert session.buffer.sample_count == 3840
        assert not session.flow_paused
        replies = [session.replies.get_nowait() for _ in range(session.replies.qsize())]
        assert not any(r["type"] == "flow" and r["action"] == "pause" for r in replies)
    finally:
        await session.close()
        store.close()


@pytest.mark.asyncio
async def test_audio_capacity_stops_new_capture_without_cancelling_accepted_audio(tmp_path):
    from sightline_speaker.faces import FaceTrack

    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config()))
    session.faces.tracks["face"] = FaceTrack("face")
    session.select(TargetConfig(type="target", generation=1, target_id="face"))
    session.pending = 1
    session.buffer.max_pcm_bytes = 1920 * 4
    try:
        for sample in range(0, 1920, 640):
            session.buffer.frame(sample, np.zeros((8, 8, 3), np.uint8))
        await session.packet(encode_packet(1, 1, 0, 10, np.zeros(1920, "<f4").tobytes()))
        await session.packet(encode_packet(1, 1, 1920, 10.12, np.zeros(640, "<f4").tobytes()))
        assert session.accepted_end == 1920
        assert session.end_sample == 1920
        assert session.buffer.sample_count == 1920
        assert not session.cancel.is_set()
        replies = [session.replies.get_nowait() for _ in range(session.replies.qsize())]
        assert any(r["type"] == "flow" and r["reason"] == "device_cannot_keep_up" for r in replies)
    finally:
        await session.close()
        store.close()


@pytest.mark.asyncio
async def test_scene_changes_during_drain_do_not_cancel_previously_accepted_speech(
    tmp_path, monkeypatch
):
    from sightline_speaker.faces import FaceObservation, FaceTrack

    store = Store(Settings(data_dir=tmp_path), start_worker=False, load_model=False)
    session = LiveSession(store, LiveConfig.model_validate(config()))
    observed = FaceObservation(0, (0.2, 0.2, 0.2, 0.4), np.zeros((5, 2)), np.zeros(2))
    session.faces.tracks["face"] = FaceTrack("face", [observed])
    session.select(TargetConfig(type="target", generation=1, target_id="face"))
    session.pending = 1
    for sample in range(0, 1920, 640):
        session.buffer.frame(sample, np.zeros((8, 8, 3), np.uint8))
    session.buffer.audio(0, 10, np.zeros(1920, np.float32))
    session.accepted_end = 1920
    session.end(1920)
    monkeypatch.setattr(
        "sightline_speaker.live_session.decode_frame", lambda _: np.zeros((8, 8, 3), np.uint8)
    )
    monkeypatch.setattr(session.faces, "detect", lambda *_: session.faces.tracks.clear())
    try:
        await session.packet(encode_packet(2, 1, 4000, 10.25, b"jpeg"))
        assert session.generation == 1
        assert session.buffer.sample_count == 1920
        assert session.drain_track.observations[0] is observed
    finally:
        await session.close()
        store.close()
