import importlib
import time

import pytest
from fastapi.testclient import TestClient


def modules():
    try:
        return [
            importlib.import_module("sightline_speaker." + name)
            for name in ["api", "jobs", "settings"]
        ]
    except ModuleNotFoundError:
        pytest.fail("local inference API is not implemented")


@pytest.fixture
def client(tmp_path):
    api, jobs, settings = modules()
    config = settings.Settings(data_dir=tmp_path, max_upload_bytes=100)
    store = jobs.Store(config, load_model=False)
    with TestClient(api.create_app(config, store=store), base_url="http://localhost") as client:
        yield client


@pytest.mark.parametrize("url", ["/clips/unknown", "/jobs/unknown", "/jobs/unknown/audio"])
def test_unknown_ids_have_stable_error(client, url):
    response = client.get(url)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_forbidden_origin_is_rejected_before_mutation(client):
    response = client.post(
        "/clips",
        headers={"Origin": "https://evil.example"},
        files={"file": ("x.mp4", b"x", "video/mp4")},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden_origin"


def test_supported_origin_receives_exact_cors_header(client):
    response = client.get("/health", headers={"Origin": "http://localhost:3001"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3001"
    assert not response.json()["ready"]


def test_unsupported_mime_and_empty_video_are_rejected(client):
    assert (
        client.post("/clips", files={"file": ("photo.png", b"png", "image/png")}).status_code == 415
    )
    response = client.post("/clips", files={"file": ("empty.mp4", b"", "video/mp4")})
    assert response.status_code == 422
    assert response.json()["code"] == "empty_upload"


def test_upload_limit_is_streamed_and_partial_file_cleaned(client):
    response = client.post("/clips", files={"file": ("huge.mp4", b"x" * 101, "video/mp4")})
    assert response.status_code == 413
    assert response.json()["code"] == "upload_too_large"
    assert not list(client.app.state.store.settings.data_dir.rglob("input.*"))


def test_mime_spoofing_fails_analysis_without_fake_ready(client):
    response = client.post("/clips", files={"file": ("fake.mp4", b"not a video", "video/mp4")})
    assert response.status_code == 202
    clip = response.json()
    deadline = time.monotonic() + 3
    while clip["status"] not in ["failed", "ready"] and time.monotonic() < deadline:
        time.sleep(0.01)
        clip = client.get("/clips/" + clip["id"]).json()
    assert clip["status"] == "failed"
    assert clip["error"]["code"] == "invalid_media"


def test_network_rebinding_host_is_rejected(client):
    assert client.get("/health", headers={"Host": "evil.example"}).status_code == 403


def test_unknown_target_and_server_paths_are_rejected(client):
    response = client.post(
        "/clips/no-such-id/extract", json={"target_id": "unknown", "generation": 1}
    )
    assert response.status_code == 404
    response = client.post(
        "/clips/no-such-id/extract",
        json={"target_id": "unknown", "generation": 1, "path": "/etc/passwd"},
    )
    assert response.status_code == 422


def test_real_video_without_audio_fails_analysis(tmp_path):
    import subprocess

    api, jobs, settings = modules()
    path = tmp_path / "silent.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=64x64:rate=10:duration=0.2",
            "-c:v",
            "libx264",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    config = settings.Settings(data_dir=tmp_path / "sessions")
    store = jobs.Store(config, load_model=False)
    with TestClient(api.create_app(config, store), base_url="http://localhost") as client:
        clip = client.post(
            "/clips", files={"file": ("silent.mp4", path.read_bytes(), "video/mp4")}
        ).json()
        deadline = time.monotonic() + 3
        while clip["status"] not in ["failed", "ready"] and time.monotonic() < deadline:
            time.sleep(0.01)
            clip = client.get("/clips/" + clip["id"]).json()
        assert clip["status"] == "failed"
        assert "audio" in clip["error"]["message"]


def test_decoded_duration_limit_is_used_by_api(tmp_path, offset_video):
    api, jobs, settings = modules()
    config = settings.Settings(data_dir=tmp_path / "sessions", max_duration=0.3)
    store = jobs.Store(config, load_model=False)
    with TestClient(api.create_app(config, store), base_url="http://localhost") as client:
        clip = client.post(
            "/clips", files={"file": ("offset.mov", offset_video.read_bytes(), "video/quicktime")}
        ).json()
        deadline = time.monotonic() + 3
        while clip["status"] not in ["failed", "ready"] and time.monotonic() < deadline:
            time.sleep(0.01)
            clip = client.get("/clips/" + clip["id"]).json()
        assert clip["status"] == "failed"
        assert "duration" in clip["error"]["message"]


def test_invalid_target_on_ready_clip(client):
    store = client.app.state.store
    clip = store.create_clip("x.mp4")
    clip.status = "ready"
    response = client.post(
        "/clips/" + clip.id + "/extract", json={"target_id": "unknown", "generation": 1}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_target"


def test_cancelled_upload_removes_partial_session(client, monkeypatch):
    import asyncio

    from starlette.datastructures import UploadFile

    original = UploadFile.read
    calls = [0]

    async def interrupted(self, size=-1):
        calls[0] += 1
        if calls[0] > 1:
            raise asyncio.CancelledError()
        return await original(self, 1)

    monkeypatch.setattr(UploadFile, "read", interrupted)
    with pytest.raises(RuntimeError, match="No response returned"):
        client.post("/clips", files={"file": ("x.mp4", b"partial", "video/mp4")})
    assert not client.app.state.store.clips
    assert not list(client.app.state.store.settings.data_dir.rglob("input.*"))


def test_origin_validation_accepts_local_http_and_deployed_https():
    import pytest

    from sightline_speaker.settings import Settings

    for ok in ["http://localhost:3001", "http://127.0.0.1:5173", "https://sightline.example.com"]:
        assert Settings(origin=ok).origin == ok
    bad_origins = ["http://example.com", "https://x.com/path", "http://localhost", "ftp://h:1", "*"]
    for bad in bad_origins:
        with pytest.raises(ValueError):
            Settings(origin=bad)
