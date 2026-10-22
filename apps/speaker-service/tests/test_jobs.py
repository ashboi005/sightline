import importlib
import threading
import time

import pytest


def api():
    try:
        return importlib.import_module("sightline_speaker.jobs")
    except ModuleNotFoundError:
        pytest.fail("bounded job lifecycle is not implemented")


def settings(tmp_path, **kwargs):
    module = importlib.import_module("sightline_speaker.settings")
    return module.Settings(data_dir=tmp_path, **kwargs)


def test_only_two_waiting_tasks_are_accepted(tmp_path):
    module = api()
    store = module.Store(settings(tmp_path), start_worker=False)
    try:
        store.submit(lambda: None)
        store.submit(lambda: None)
        with pytest.raises(module.ServiceError, match="queue"):
            store.submit(lambda: None)
    finally:
        store.close()


def test_cancelled_job_never_exposes_audio(tmp_path):
    module = api()
    store = module.Store(settings(tmp_path), start_worker=False)
    try:
        clip = store.create_clip("video.mp4")
        clip.status = "ready"
        from sightline_speaker.faces import FaceTrack

        clip.tracks = [FaceTrack("person")]
        store.separator = object()
        job = store.extract(clip.id, "person", 7)
        store.cancel_job(job.id)
        assert store.job_view(job.id).status == "cancelled"
        assert store.job_view(job.id).audio_url is None
    finally:
        store.close()


def test_idle_retention_removes_clip_and_outputs(tmp_path):
    module = api()
    clock = [0.0]
    store = module.Store(
        settings(tmp_path, retention_seconds=10), start_worker=False, clock=lambda: clock[0]
    )
    try:
        clip = store.create_clip("video.mp4")
        clip.path.write_bytes(b"video")
        clip.status = "ready"
        clock[0] = 11
        store.cleanup()
        assert not clip.path.exists()
        with pytest.raises(module.ServiceError, match="Unknown"):
            store.clip_view(clip.id)
    finally:
        store.close()


def test_total_disk_budget_includes_upload_partials(tmp_path):
    module = api()
    store = module.Store(settings(tmp_path, max_data_bytes=10), start_worker=False)
    try:
        first = store.create_clip("video.mp4")
        first.path.write_bytes(b"x" * 8)
        with pytest.raises(module.ServiceError, match="storage"):
            store.ensure_capacity(3)
    finally:
        store.close()


def test_worker_cannot_run_two_inferences_at_once(tmp_path):
    module = api()
    store = module.Store(settings(tmp_path), load_model=False)
    active, peak = [0], [0]
    finished = threading.Event()

    def task():
        active[0] += 1
        peak[0] = max(peak[0], active[0])
        time.sleep(0.02)
        active[0] -= 1

    try:
        store.submit(task)
        store.submit(task)
        store.submit(finished.set) if store.queue.qsize() < 2 else None
        deadline = time.monotonic() + 2
        while store.queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.01)
        assert store.queue.unfinished_tasks == 0
        assert peak[0] == 1
    finally:
        store.close()


def test_clip_and_job_metadata_are_bounded(tmp_path):
    module = api()
    store = module.Store(settings(tmp_path, max_clips=2, max_jobs_per_clip=1), start_worker=False)
    try:
        clip = store.create_clip("x.mp4")
        store.create_clip("x.mp4")
        with pytest.raises(module.ServiceError, match="clip limit"):
            store.create_clip("x.mp4")
        from sightline_speaker.faces import FaceTrack

        clip.status = "ready"
        clip.tracks = [FaceTrack("person")]
        store.separator = object()
        store.extract(clip.id, "person", 1)
        with pytest.raises(module.ServiceError, match="job limit"):
            store.extract(clip.id, "person", 2)
    finally:
        store.close()


def test_cancel_during_model_execution_discards_completed_window(tmp_path, monkeypatch):
    module = api()
    from pathlib import Path

    import numpy as np

    from sightline_speaker.faces import FaceTrack
    from sightline_speaker.media import DecodedMedia

    media = DecodedMedia(
        Path("unused"), np.ones(6400, np.float32), [], np.array([0.0]), 64, 64, 0.4
    )
    monkeypatch.setattr(module, "decode_media", lambda *args: media)
    audio = importlib.import_module("sightline_speaker.audio")
    monkeypatch.setattr(audio, "prepare_frames", lambda *args: np.zeros((50, 88, 88), np.float32))
    entered, release = threading.Event(), threading.Event()

    class Model:
        device = "test"

        def extract(self, pcm, frames):
            entered.set()
            release.wait(2)
            return pcm

    store = module.Store(settings(tmp_path), load_model=False)
    try:
        clip = store.create_clip("x.mp4")
        clip.status = "ready"
        clip.tracks = [FaceTrack("person")]
        store.separator = Model()
        job = store.extract(clip.id, "person", 9)
        assert entered.wait(2)
        store.cancel_job(job.id)
        release.set()
        deadline = time.monotonic() + 2
        while store.queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.01)
        assert store.job_view(job.id).status == "cancelled"
        assert store.job_view(job.id).audio_url is None
        assert not (clip.path.parent / job.id).exists()
    finally:
        release.set()
        store.close()


def test_orphan_sessions_are_cleaned_after_restart(tmp_path):
    module = api()
    orphan = tmp_path / ("a" * 32)
    orphan.mkdir()
    (orphan / "input.mp4").write_bytes(b"old")
    unrelated = tmp_path / "keep"
    unrelated.mkdir()
    (unrelated / "note").write_text("keep")
    store = module.Store(settings(tmp_path), start_worker=False)
    try:
        assert not orphan.exists()
        assert unrelated.exists()
    finally:
        store.close()


def test_data_directory_cannot_be_owned_by_two_services(tmp_path):
    module = api()
    store = module.Store(settings(tmp_path), start_worker=False)
    try:
        with pytest.raises(module.ServiceError, match="already in use"):
            module.Store(settings(tmp_path), start_worker=False)
    finally:
        store.close()


def test_shutdown_keeps_data_lease_until_active_worker_exits(tmp_path, monkeypatch):
    module = api()
    entered, release = threading.Event(), threading.Event()
    store = module.Store(settings(tmp_path), load_model=False)

    def blocked():
        entered.set()
        release.wait(3)

    store.submit(blocked)
    assert entered.wait(2)
    original_join = store.thread.join
    monkeypatch.setattr(store.thread, "join", lambda **kwargs: None)
    try:
        store.close()
        with pytest.raises(module.ServiceError, match="already in use"):
            other = module.Store(settings(tmp_path), start_worker=False)
            other.close()
    finally:
        release.set()
        original_join(timeout=3)


def test_output_reservations_prevent_upload_overcommit(tmp_path):
    module = api()
    store = module.Store(settings(tmp_path, max_data_bytes=10), start_worker=False)
    try:
        store.reserve(8)
        with pytest.raises(module.ServiceError, match="storage"):
            store.ensure_capacity(3)
        store.release(8)
        store.ensure_capacity(10)
    finally:
        store.close()


def test_manual_region_replaces_overlapping_automatic_tracks(tmp_path, monkeypatch):
    module = api()
    from pathlib import Path

    import numpy as np

    from sightline_speaker.faces import FaceObservation, FaceTrack
    from sightline_speaker.media import DecodedMedia

    def face(identity, box):
        return FaceTrack(identity, [FaceObservation(0, box, np.zeros((5, 2)), np.zeros(2))])

    old = face("old-right", (0.7, 0.1, 0.2, 0.5))
    left = face("left", (0.1, 0.1, 0.2, 0.5))
    manual = face("manual-right", (0.7, 0.1, 0.2, 0.5))
    manual.manual = True
    monkeypatch.setattr(
        module,
        "decode_media",
        lambda *args: DecodedMedia(
            Path("unused"), np.zeros(16000), [np.zeros((32, 32, 3))], np.array([0]), 32, 32, 1
        ),
    )
    monkeypatch.setattr(module, "manual_track", lambda *args: manual)
    store = module.Store(settings(tmp_path), start_worker=False)
    try:
        clip = store.create_clip("x.mp4")
        clip.status = "ready"
        clip.tracks = [left, old]
        store._analyse(clip, (0.65, 0.05, 0.35, 0.6))
        assert [t.id for t in clip.tracks] == ["left", "manual-right"]
    finally:
        store.close()
