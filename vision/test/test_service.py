import base64
import json
import threading
import urllib.error
import urllib.request

import cv2
import numpy as np
import pytest

from service import LoadingEngine, create_server, decode_image
from sessions import Sessions


def jpeg():
    ok, data = cv2.imencode(".jpg", np.zeros((80, 120, 3), np.uint8))
    assert ok
    return base64.b64encode(data).decode()


def test_image_validation_before_decoding():
    assert decode_image(jpeg()).shape == (80, 120, 3)
    for value in ["not-base64", "https://camera/stream", 2, ""]:
        with pytest.raises(ValueError):
            decode_image(value)
    _, png = cv2.imencode(".png", np.zeros((80, 120, 3), np.uint8))
    with pytest.raises(ValueError):
        decode_image(base64.b64encode(png).decode())
    _, huge = cv2.imencode(".jpg", np.zeros((80, 1281, 3), np.uint8))
    with pytest.raises(ValueError):
        decode_image(base64.b64encode(huge).decode())


def test_loading_service_forwards_person_selection_to_the_ready_engine():
    from types import SimpleNamespace

    loading = LoadingEngine.__new__(LoadingEngine)
    loading.engine = SimpleNamespace(select=lambda image, point, box, kind: {"label": kind})
    assert loading.select(None, [0.3, 0.4], None, kind="person") == {"label": "person"}


def test_sessions_expire_and_retain_no_more_than_four():
    clock = [10]
    sessions = Sessions(lambda: clock[0])
    tokens = [sessions.add({"label": str(i)}) for i in range(5)]
    with pytest.raises(KeyError):
        sessions.get(tokens[0])
    assert sessions.get(tokens[-1])["label"] == "4"
    clock[0] = 611
    with pytest.raises(KeyError):
        sessions.get(tokens[-1])


class ImageBoundary:
    """Replace only expensive YOLO inference; HTTP and image validation stay real."""

    def status(self):
        return {"status": "ready"}

    def select(self, image, point, box):
        assert image.shape == (80, 120, 3)
        return {"token": "test-token", "box": [0, 0, 1, 1], "label": "Object"}

    def track(self, token, image):
        assert image.shape == (80, 120, 3)
        return {
            "status": "matched",
            "box": [0.1, 0.2, 0.5, 0.7],
            "score": 0.9,
            "method": "temporal",
        }

    def match(self, token, image, stream=0):
        return {"status": "searching"}

    def clear(self, token):
        pass


def test_http_requires_secret_and_rejects_malformed_and_oversized_input():
    server = create_server(ImageBoundary(), "test-secret")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"

    def send(body, secret="test-secret"):
        request = urllib.request.Request(
            url, body, {"Content-Type": "application/json", "Authorization": f"Bearer {secret}"}
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    try:
        assert send(b'{"action":"status"}', "wrong")[0] == 401
        assert send(b"not-json")[0] == 400
        request = urllib.request.Request(
            url,
            b"x",
            {
                "Content-Type": "application/json",
                "Authorization": "Bearer test-secret",
                "Content-Length": str(2 * 1024 * 1024 + 1),
            },
        )
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=2)
        assert error.value.code == 413
        assert (
            send(
                json.dumps({"action": "select", "image": "invalid", "point": [0.5, 0.5]}).encode()
            )[0]
            == 400
        )
        status, result = send(
            json.dumps({"action": "select", "image": jpeg(), "point": [0.5, 0.5]}).encode()
        )
        assert status == 200
        assert result["label"] == "Object"
        status, result = send(
            json.dumps({"action": "track", "token": "test-token", "image": jpeg()}).encode()
        )
        assert (
            status == 200
            and result["method"] == "temporal"
            and result["box"] == [0.1, 0.2, 0.5, 0.7]
        )
        assert (
            send(
                json.dumps(
                    {"action": "match", "token": "test-token", "image": jpeg(), "stream": True}
                ).encode()
            )[0]
            == 400
        )
        assert send(b'{"action":"url","url":"https://camera/stream"}')[0] == 400
    finally:
        server.shutdown()
        server.server_close()


def test_idle_service_expires_references_without_another_request():
    class ExpiringBoundary(ImageBoundary):
        def __init__(self):
            self.clock = 0
            self.sessions = Sessions(lambda: self.clock)

        def expire(self):
            self.sessions.expire()

    boundary = ExpiringBoundary()
    token = boundary.sessions.add({"label": "temporary"})
    server = create_server(boundary, "test-secret")
    try:
        boundary.clock = 601
        server.service_actions()
        assert token not in boundary.sessions.items
    finally:
        server.server_close()


def test_clearing_last_reference_releases_predictor_camera_buffers():
    from types import SimpleNamespace

    from engine import VisionEngine

    engine = VisionEngine.__new__(VisionEngine)
    engine.sessions = Sessions()
    token = engine.sessions.add({"label": "temporary"})
    engine.active = token
    engine.visual = SimpleNamespace(
        predictor=SimpleNamespace(batch="camera pixels", results="camera results")
    )
    engine.detector = SimpleNamespace(predictor=SimpleNamespace(batch="scene pixels"))
    engine.clear(token)
    assert not engine.sessions.items
    assert engine.visual.predictor is None
    assert engine.detector.predictor is None


def test_acquisition_budget_stops_before_slow_proposals_can_starve_scene(monkeypatch):
    from types import SimpleNamespace

    import engine as module

    engine = module.VisionEngine.__new__(module.VisionEngine)
    engine.sessions = Sessions()
    reference = object()
    token = engine.sessions.add({"reference": reference, "embedding": None})

    def forbidden(*args, **kwargs):
        raise AssertionError("Work continued after acquisition budget was exhausted")

    engine.visual = SimpleNamespace(predict=forbidden)
    engine.options = {}
    engine.active = token
    clock = [0.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])

    def search(*args, **kwargs):
        clock[0] += 0.3
        return {"status": "searching"}

    monkeypatch.setattr(module, "choose_match", search)
    monkeypatch.setattr(module, "choose_appearance", forbidden)
    assert engine.find(token, np.zeros((240, 320, 3), np.uint8)) == {"status": "searching"}


def test_reacquisition_uses_original_selection_instead_of_a_drifted_recent_crop():
    from types import SimpleNamespace

    from test_matching import textured_image

    from engine import VisionEngine
    from matching import Reference

    selected = textured_image(42)
    unrelated = textured_image(88)
    engine = VisionEngine.__new__(VisionEngine)
    engine.sessions = Sessions()
    original = Reference(selected, (0, 0, 1, 1))
    drifted = Reference(unrelated, (0, 0, 1, 1))
    token = engine.sessions.add(
        {
            "reference": original,
            "sceneReference": drifted,
            "targetReference": drifted,
            "embedding": None,
        }
    )
    engine.active = token
    engine.visual = SimpleNamespace(predict=lambda *args, **kwargs: [SimpleNamespace(boxes=[])])
    engine.options = {}
    assert engine.find(token, unrelated)["status"] == "searching"
    recovered = engine.find(token, selected)
    assert recovered["status"] == "matched"
    assert recovered["score"] > 0.8
    assert engine.sessions.get(token)["reference"] is original


@pytest.mark.parametrize("role", ["scene", "target"])
def test_unverified_acquisition_cannot_seed_another_camera_instance(role):
    from types import SimpleNamespace

    from test_matching import textured_image
    from test_memory_tracking import SegmentationBoundary

    from engine import VisionEngine
    from matching import Reference

    selected, unrelated = textured_image(42), textured_image(88)
    engine = VisionEngine.__new__(VisionEngine)
    engine.sessions = Sessions()
    engine.appearance = None
    engine.segmentation = SegmentationBoundary([([0, 0, 1, 1], 0.99, 0.94)])
    original = Reference(selected, (0, 0, 1, 1))
    token = engine.sessions.add(
        {
            "reference": original,
            "scene": SimpleNamespace(
                active=False, recovering=False, update=lambda frame: {"status": "searching"}
            ),
            "target": None,
            "stream": 0,
        }
    )
    # Even a noisy acquisition result must not establish a new identity anchor.
    engine.find = lambda *args: {"status": "matched", "box": [0, 0, 1, 1], "score": 0.99}
    result = engine.track(token, unrelated) if role == "scene" else engine.match(token, unrelated)
    assert result == {"status": "searching"}
    assert engine.sessions.get(token)["reference"] is original
    if role == "target":
        assert engine.sessions.get(token)["target"] is None


def test_small_object_can_acquire_from_context_and_two_mask_observations():
    from types import SimpleNamespace

    from test_memory_tracking import SegmentationBoundary

    from engine import VisionEngine

    random = np.random.default_rng(73)
    scene = random.integers(0, 255, (150, 200, 3), dtype=np.uint8)
    box = [80 / 200, 60 / 150, 96 / 200, 84 / 150]
    target = scene.copy()
    target[60:84, 80:83] = 255 - target[60:84, 80:83]
    backend = SegmentationBoundary([(box, 0.99, 0.95)] * 4)
    backend.similarity = lambda *args: 0.9
    model = SimpleNamespace(pe=SimpleNamespace(detach=lambda: SimpleNamespace(clone=lambda: None)))
    visual = SimpleNamespace(
        model=model, predict=lambda *args, **kwargs: [SimpleNamespace(boxes=[])]
    )
    engine = VisionEngine.__new__(VisionEngine)
    engine.segmentation = backend
    engine.appearance = None
    engine.visual = visual
    engine.options = {}
    engine.sessions = Sessions()
    token = engine.select(scene, None, box)["token"]
    original = engine.sessions.get(token)["reference"]
    assert engine.match(token, target) == {"status": "searching"}
    result = engine.match(token, target)
    assert result["status"] == "matched"
    assert result["box"] == box
    selected = engine.sessions.get(token)
    assert selected["target"].reference is original
    assert selected["scene"] is not selected["target"]


def test_ambiguous_surroundings_do_not_hide_a_unique_original_object():
    from types import SimpleNamespace

    from test_memory_tracking import SegmentationBoundary

    from engine import VisionEngine

    scene = np.random.default_rng(73).integers(0, 255, (150, 200, 3), dtype=np.uint8)
    box = [80 / 200, 60 / 150, 96 / 200, 84 / 150]
    target = np.full((200, 300, 3), 170, np.uint8)
    patch = scene[36:108, 56:120].copy()
    target[30:102, 30:94] = patch
    target[110:182, 190:254] = patch
    target[134:158, 214:217] = 255 - target[134:158, 214:217]
    expected = [54 / 300, 54 / 200, 70 / 300, 78 / 200]
    engine = VisionEngine.__new__(VisionEngine)
    engine.segmentation = SegmentationBoundary([(box, 0.99, 0.95), (expected, 0.99, 0.95)])
    engine.appearance = None
    engine.visual = SimpleNamespace(
        model=SimpleNamespace(
            pe=SimpleNamespace(detach=lambda: SimpleNamespace(clone=lambda: None))
        ),
        predict=lambda *args, **kwargs: [SimpleNamespace(boxes=[])],
    )
    engine.options = {}
    engine.sessions = Sessions()
    token = engine.select(scene, None, box)["token"]
    result = engine.match(token, target)
    assert result["status"] == "matched"
    assert np.allclose(result["box"], expected)
