"""Cross-camera policy tests; model accuracy uses the private supplied clip."""

from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from test_memory_tracking import SegmentationBoundary

from engine import VisionEngine
from person_tracking import PersonIdentity, select_person
from sessions import Sessions


def test_person_selection_requires_a_detected_body_at_the_gaze_point():
    from matching import Candidate

    people = [Candidate((0.1, 0.1, 0.4, 0.9), 0.9), Candidate((0.6, 0.1, 0.9, 0.9), 0.9)]
    assert select_person(people, [0.2, 0.5], None).box == people[0].box
    with pytest.raises(ValueError, match="person"):
        select_person(people, [0.5, 0.5], None)
    with pytest.raises(ValueError, match="overlap|clearer"):
        select_person(people + [Candidate((0.15, 0.2, 0.45, 0.8), 0.9)], [0.25, 0.5], None)


def test_person_identity_rejects_bystanders_and_requires_two_observations():
    from matching import Candidate

    identity = PersonIdentity(np.array([1.0, 0.0, 0.0]))
    selected = Candidate((0.1, 0.1, 0.4, 0.9), 0.9)
    stranger = Candidate((0.6, 0.1, 0.9, 0.9), 0.95)
    features = np.array([[0.9, 0.436, 0], [0.4, 0, 0.917]])
    view = identity.new_view()
    assert view.update([selected, stranger], features, 0)["status"] == "searching"
    result = view.update([selected, stranger], features, 0.1)
    assert result["status"] == "matched" and result["box"] == list(selected.box)
    assert view.update([stranger], features[1:], 0.2)["status"] == "searching"
    assert view.update([selected, stranger], features, 0.3)["status"] == "matched"
    assert view.update([selected, stranger], features, 0.4)["status"] == "matched"
    assert np.array_equal(identity.anchor, [1, 0, 0])


def test_two_similarly_looking_people_remain_ambiguous_without_switching_identity():
    from matching import Candidate

    identity = PersonIdentity(np.array([1.0, 0.0, 0.0]))
    people = [Candidate((0.1, 0.1, 0.4, 0.9), 0.9), Candidate((0.6, 0.1, 0.9, 0.9), 0.9)]
    view = identity.new_view()
    for now in [0, 0.1, 0.2]:
        assert (
            view.update(people, np.array([[0.9, 0.436, 0], [0.88, 0, 0.475]]), now)["status"]
            == "ambiguous"
        )


def test_person_recovery_cannot_confirm_a_different_location_or_old_observation():
    from matching import Candidate

    identity = PersonIdentity(np.array([1.0, 0.0, 0.0]))
    view = identity.new_view()
    left = Candidate((0.1, 0.1, 0.3, 0.8), 0.9)
    right = Candidate((0.7, 0.1, 0.9, 0.8), 0.9)
    feature = np.array([[1, 0, 0]])
    assert view.update([left], feature, 0)["status"] == "searching"
    assert view.update([right], feature, 0.1)["status"] == "searching"
    assert view.update([right], feature, 2)["status"] == "searching"
    assert view.update([right], feature, 2.1)["status"] == "matched"


def test_torso_selection_resolves_the_full_detected_person():
    from matching import Candidate

    person = Candidate((0.1, 0.1, 0.5, 0.95), 0.9)
    assert select_person([person], None, [0.2, 0.3, 0.4, 0.5]) is person


def test_locked_view_does_not_accept_a_similar_stranger_at_the_same_location():
    from matching import Candidate

    person = Candidate((0.1, 0.1, 0.5, 0.95), 0.9)
    view = PersonIdentity([1.0, 0.0, 0.0]).new_view()
    original = np.array([[0.8, 0.6, 0.0]])
    view.update([person], original, 0)
    assert view.update([person], original, 0.1)["status"] == "matched"
    # A sole visible newcomer passes the old cross-camera threshold of .65,
    # but contradicts the same-camera identity that was actually locked.
    stranger = np.array([[0.7, 0.0, np.sqrt(0.51)]])
    for now in [0.2, 0.3, 0.5, 1, 2.2, 2.3]:
        assert view.update([person], stranger, now)["status"] != "matched"


def test_lost_identity_requires_reselection_but_brief_stream_gaps_do_not():
    from matching import Candidate

    person = Candidate((0.1, 0.1, 0.5, 0.95), 0.9)
    view = PersonIdentity([1.0, 0.0]).new_view()
    feature = np.array([[1.0, 0.0]])
    view.update([person], feature, 0)
    view.update([person], feature, 0.1)
    assert view.update([], [], 0.3)["status"] == "searching"
    assert view.update([person], feature, 0.5)["status"] == "matched"
    lost = view.update([], [], 2.6)
    assert lost["status"] == "lost" and lost["requiresReselect"]
    assert view.update([person], feature, 2.7)["status"] == "lost"


def test_known_bystander_cannot_become_the_selected_person_when_alone():
    from matching import Candidate

    person = Candidate((0.1, 0.1, 0.5, 0.95), 0.9)
    other = Candidate((0.6, 0.1, 0.9, 0.95), 0.95)
    original = np.array([1.0, 0.0, 0.0])
    bystander = np.array([0.72, 0.0, np.sqrt(1 - 0.72**2)])
    view = PersonIdentity(original, distractors=[bystander]).new_view()
    for now in [0, 0.1, 0.2]:
        assert view.update([other], [bystander], now)["status"] != "matched"
    view.update([person], [original], 0.3)
    assert view.update([person], [original], 0.4)["status"] == "matched"


def test_person_selection_seeds_its_scene_and_returns_the_actual_reference_crop(monkeypatch):
    import base64

    from matching import Candidate

    person = Candidate((0.1, 0.1, 0.5, 0.95), 0.9)
    bystander = Candidate((0.6, 0.1, 0.9, 0.95), 0.9)
    engine = VisionEngine.__new__(VisionEngine)
    engine.sessions = Sessions()
    engine.detect_people = lambda _: [person, bystander]
    engine.person_appearance = SimpleNamespace(describe=lambda _: np.array([[1, 0], [0.7, 0.714]]))
    monkeypatch.setattr("engine.time.monotonic", lambda: 1.0)
    result = engine.select(np.full((240, 320, 3), 120, np.uint8), [0.3, 0.5], None, kind="person")
    reference = engine.sessions.get(result["token"])
    assert reference["scene"].box == person.box
    assert reference["target"].box is None
    assert len(reference["identity"].distractors) == 1
    jpeg = base64.b64decode(result["preview"].split(",")[1])
    preview = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert max(preview.shape[:2]) <= 192
    assert preview.mean() == pytest.approx(120, abs=1)


def test_an_acquired_person_lock_cannot_transfer_to_a_replacement_target_camera():
    from matching import Candidate

    identity = PersonIdentity([1.0, 0.0])
    view = identity.new_view(Candidate((0.1, 0.1, 0.5, 0.9), 0.9), 0)
    engine = VisionEngine.__new__(VisionEngine)
    engine.sessions = Sessions()
    token = engine.sessions.add(
        {"kind": "person", "identity": identity, "target": view, "stream": 1}
    )
    result = engine.match(token, np.zeros((10, 10, 3), np.uint8), stream=2)
    assert result["status"] == "lost" and result["requiresReselect"]


def test_person_descriptors_use_a_bounded_fixed_batch_as_bystanders_enter():
    import torch

    from learned_appearance import PersonAppearanceModel

    batches = []

    def model(tensor):
        batches.append(tensor.shape[0])
        return tensor.mean(dim=(2, 3))

    appearance = PersonAppearanceModel.__new__(PersonAppearanceModel)
    appearance.device = "cpu"
    appearance.model = model
    appearance.mean = torch.zeros((1, 3, 1, 1))
    appearance.std = torch.ones((1, 3, 1, 1))
    image = np.full((64, 32, 3), (140, 100, 80), np.uint8)
    assert appearance.describe([image]).shape == (1, 3)
    assert appearance.describe([image] * 5).shape == (5, 3)
    assert batches == [4, 4, 4]


def setup_case(color=(160, 55, 15)):
    patch = np.full((64, 32, 3), color, np.uint8)
    patch[:14] = (220, 225, 225)
    for x in (7, 15, 23):
        patch[18:, x : x + 2] = np.array(color) * 0.65
    scene = np.full((180, 240, 3), 90, np.uint8)
    scene[60:124, 80:112] = np.uint8(cv2.GaussianBlur(patch, (0, 0), 2.5) * 0.5 + 30)
    target = np.full((360, 480, 3), 35, np.uint8)
    target[100:292, 260:356] = cv2.resize(patch, (96, 192))
    source_box = [80 / 240, 60 / 180, 112 / 240, 124 / 180]
    target_box = [260 / 480, 100 / 360, 356 / 480, 292 / 360]
    backend = SegmentationBoundary([(source_box, 0.99, 0.95)] + [(target_box, 0.99, 0.95)] * 8)
    backend.similarity = lambda *args: 0.9

    class Box:
        xyxy = np.array([[260, 100, 356, 292]], np.float32)
        conf = np.array([0.7], np.float32)

    class Tensor:
        def __init__(self, array):
            self.array = array

        def cpu(self):
            return self

        def tolist(self):
            return self.array.tolist()

    proposal = SimpleNamespace(xyxy=[Tensor(Box.xyxy[0])], conf=Box.conf)
    model = SimpleNamespace(pe=SimpleNamespace(detach=lambda: SimpleNamespace(clone=lambda: None)))
    engine = VisionEngine.__new__(VisionEngine)
    engine.segmentation = backend
    engine.appearance = SimpleNamespace(score=lambda *args: 0.9)
    engine.visual = SimpleNamespace(
        model=model, predict=lambda *args, **kwargs: [SimpleNamespace(boxes=[proposal])]
    )
    engine.options = {}
    engine.sessions = Sessions()
    token = engine.select(scene, None, source_box)["token"]
    return engine, token, scene, target, target_box


def test_different_camera_quality_can_acquire_without_a_target_rectangle(monkeypatch):
    # This tests evidence policy; the deadline has its own controlled-clock test.
    monkeypatch.setattr("engine.time.monotonic", lambda: 0.0)
    engine, token, _, target, target_box = setup_case()
    original = engine.sessions.get(token)["reference"]
    engine.sessions.get(token)["cross_acquisition"].clock = lambda: 0.0
    assert engine.match(token, target)["status"] != "matched"
    result = engine.match(token, target)
    assert result["status"] == "matched"
    assert np.allclose(result["box"], target_box)
    assert "acquisition" not in result
    assert engine.sessions.get(token)["target"].reference is original


def test_another_coloured_case_cannot_pass_on_high_model_scores():
    engine, token, _, target, _ = setup_case()
    target[142:292, 260:356] = (15, 55, 160)
    for _ in range(3):
        assert engine.match(token, target)["status"] != "matched"
    assert engine.sessions.get(token)["target"] is None


def test_malformed_mask_clears_confirmation_before_another_valid_observation():
    from collections import deque

    from matching import Candidate

    engine, token, _, target, box = setup_case()
    acquisition = engine.sessions.get(token)["cross_acquisition"]
    engine.segmentation.predictions = deque(
        [(box, 0.99, 0.95), ([0.5, 0.2], 0.99, 0.95), (box, 0.99, 0.95), (box, 0.99, 0.95)]
    )
    candidates = [Candidate(tuple(box), 0.7)]
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    assert acquisition.update(target, candidates, float("inf"))["status"] == "matched"


def test_acquisition_budget_exhaustion_discards_confirmation(monkeypatch):
    import engine as module
    from matching import Candidate

    engine, token, _, target, box = setup_case()
    acquisition = engine.sessions.get(token)["cross_acquisition"]
    candidates = [Candidate(tuple(box), 0.7)]
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    with monkeypatch.context() as patch:
        clock = iter([0, 0.3])
        patch.setattr(module.time, "monotonic", lambda: next(clock))
        patch.setattr(module, "choose_match", lambda *args, **kwargs: {"status": "searching"})
        assert engine.find(token, np.zeros_like(target), True)["status"] == "searching"
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    assert acquisition.update(target, candidates, float("inf"))["status"] == "matched"


def test_two_matching_cases_remain_ambiguous(monkeypatch):
    from collections import deque

    import torch

    monkeypatch.setattr("engine.time.monotonic", lambda: 0.0)
    engine, token, _, target, first = setup_case()
    target[100:292, 140:236] = target[100:292, 260:356]
    second = [140 / 480, 100 / 360, 236 / 480, 292 / 360]
    engine.segmentation.predictions = deque([(first, 0.99, 0.95), (second, 0.99, 0.95)] * 3)
    proposals = [
        SimpleNamespace(
            xyxy=torch.tensor([[260.0, 100.0, 356.0, 292.0]]), conf=torch.tensor([0.7])
        ),
        SimpleNamespace(
            xyxy=torch.tensor([[140.0, 100.0, 236.0, 292.0]]), conf=torch.tensor([0.7])
        ),
    ]
    engine.visual.predict = lambda *args, **kwargs: [SimpleNamespace(boxes=proposals)]
    for _ in range(2):
        assert engine.match(token, target)["status"] == "ambiguous"
    assert engine.sessions.get(token)["target"] is None


def test_quality_acquisition_requires_both_learned_checks():
    for weakened in ("memory", "appearance"):
        engine, token, _, target, _ = setup_case()
        if weakened == "memory":
            engine.segmentation.similarity = lambda *args: 0.5
        else:
            engine.appearance.score = lambda *args: 0.5
        for _ in range(2):
            assert engine.match(token, target)["status"] != "matched"
        assert engine.sessions.get(token)["target"] is None


def test_target_generation_change_requires_two_new_quality_observations(monkeypatch):
    monkeypatch.setattr("engine.time.monotonic", lambda: 0.0)
    engine, token, _, target, _ = setup_case()
    scene = engine.sessions.get(token)["scene"]
    engine.sessions.get(token)["cross_acquisition"].clock = lambda: 0.0
    assert engine.match(token, target, stream=0)["status"] == "searching"
    assert engine.match(token, target, stream=1)["status"] == "searching"
    assert engine.match(token, target, stream=1)["status"] == "matched"
    assert engine.sessions.get(token)["scene"] is scene and scene.active


def test_absence_and_elapsed_time_invalidate_quality_confirmation():
    from matching import Candidate

    for reset in ("absence", "expiry"):
        engine, token, _, target, box = setup_case()
        acquisition = engine.sessions.get(token)["cross_acquisition"]
        clock = [0.0]
        acquisition.clock = lambda: clock[0]
        candidates = [Candidate(tuple(box), 0.7)]
        assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
        if reset == "absence":
            assert (
                acquisition.update(np.zeros_like(target), [], float("inf"))["status"] == "searching"
            )
        else:
            clock[0] = 2
        assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
        assert acquisition.update(target, candidates, float("inf"))["status"] == "matched"


def test_proposal_backend_error_clears_pending_quality_evidence(monkeypatch):
    import pytest

    import engine as module
    from matching import Candidate

    engine, token, _, target, box = setup_case()
    acquisition = engine.sessions.get(token)["cross_acquisition"]
    candidates = [Candidate(tuple(box), 0.7)]
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    with monkeypatch.context() as patch:
        patch.setattr(module, "choose_match", lambda *args, **kwargs: {"status": "searching"})
        patch.setattr(module, "choose_appearance", lambda *args, **kwargs: {"status": "searching"})

        def failed(*args, **kwargs):
            raise RuntimeError("Proposal inference failed")

        patch.setattr(engine.visual, "predict", failed)
        with pytest.raises(RuntimeError, match="Proposal inference failed"):
            engine.find(token, target, True)
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    assert acquisition.update(target, candidates, float("inf"))["status"] == "matched"


def test_absent_first_proposal_does_not_block_a_verified_later_proposal():
    from collections import deque

    from matching import Candidate

    engine, token, _, target, box = setup_case()
    target[100:292, 140:236] = target[100:292, 260:356]
    first = [140 / 480, 100 / 360, 236 / 480, 292 / 360]
    engine.segmentation.predictions = deque([(None, 0.01, 0.2), (box, 0.99, 0.95)] * 2)
    acquisition = engine.sessions.get(token)["cross_acquisition"]
    candidates = [Candidate(tuple(first), 0.7), Candidate(tuple(box), 0.7)]
    assert acquisition.update(target, candidates, float("inf"))["status"] == "searching"
    result = acquisition.update(target, candidates, float("inf"))
    assert result["status"] == "matched"
    assert np.allclose(result["box"], box)


def test_detector_omission_cannot_resolve_real_dense_duplicate_ambiguity():
    from collections import deque

    import torch

    from appearance import choose_appearance

    engine, _, source, large_target, _ = setup_case()
    patch = cv2.resize(large_target[100:292, 260:356], (32, 64))
    source[60:124, 80:112] = cv2.GaussianBlur(patch, (0, 0), 2.5)
    target = np.full_like(large_target, 35)
    target[100:164, 260:292] = patch
    target[100:164, 140:172] = patch
    source_box = [80 / 240, 60 / 180, 112 / 240, 124 / 180]
    box = [260 / 480, 100 / 360, 292 / 480, 164 / 360]
    engine.segmentation.predictions = deque([(source_box, 0.99, 0.95)] + [(box, 0.99, 0.95)] * 4)
    proposal = SimpleNamespace(
        xyxy=torch.tensor([[260.0, 100.0, 292.0, 164.0]]), conf=torch.tensor([0.7])
    )
    engine.visual.predict = lambda *args, **kwargs: [SimpleNamespace(boxes=[proposal])]
    token = engine.select(source, None, source_box)["token"]
    reference = engine.sessions.get(token)["reference"]
    assert choose_appearance(reference, target)["status"] == "ambiguous"
    for _ in range(2):
        assert engine.match(token, target)["status"] == "ambiguous"
    assert engine.sessions.get(token)["target"] is None


def test_context_success_discards_unused_cross_camera_confirmation(monkeypatch):
    from context_acquisition import AcquiredRegion

    engine, token, _, target, box = setup_case()
    assert engine.match(token, target)["status"] == "searching"
    selected = engine.sessions.get(token)
    cross = selected["cross_acquisition"]
    assert cross.pending is not None
    prediction = engine.segmentation.predict(target, box, 0, {})
    proof = AcquiredRegion(selected["reference"], target, box, prediction)
    monkeypatch.setattr(
        selected["context_acquisition"],
        "update",
        lambda image: {
            "status": "matched",
            "box": box,
            "acquisition": proof,
        },
    )
    assert engine.match(token, target)["status"] == "matched"
    assert cross.pending is None


def test_context_inference_error_clears_both_acquisition_confirmations(monkeypatch):
    import pytest

    from matching import Candidate

    engine, token, _, target, box = setup_case()
    selected = engine.sessions.get(token)
    selected["stream"] = 0
    cross = selected["cross_acquisition"]
    context = selected["context_acquisition"]
    candidates = [Candidate(tuple(box), 0.7)]
    assert cross.update(target, candidates, float("inf"))["status"] == "searching"
    context.pending = (box, {}, cross.clock())

    def failed(image):
        raise RuntimeError("Context inference failed")

    monkeypatch.setattr(context, "update", failed)
    with pytest.raises(RuntimeError, match="Context inference failed"):
        engine.match(token, target)
    assert cross.pending is None and context.pending is None
    assert cross.update(target, candidates, float("inf"))["status"] == "searching"


def test_cross_success_discards_unused_context_confirmation(monkeypatch):
    engine, token, _, target, box = setup_case()
    selected = engine.sessions.get(token)
    context = selected["context_acquisition"]

    def unconfirmed(image):
        context.pending = (box, {}, context.clock())
        return {"status": "searching"}

    monkeypatch.setattr(context, "update", unconfirmed)
    assert engine.match(token, target)["status"] == "searching"
    assert context.pending is not None
    assert engine.match(token, target)["status"] == "matched"
    assert context.pending is None
    assert selected["cross_acquisition"].pending is None


def test_rejected_dense_patch_does_not_starve_independent_camera_acquisition():
    from appearance import choose_appearance, confirm_region

    engine, token, scene, target, expected = setup_case()
    # Only the interior resembles the blurry selection. Its bright perimeter
    # makes the full proposed crop fail the original-reference verification.
    target[10:74, 10:42] = scene[60:124, 80:112]
    target[10:16, 10:42] = 255
    target[68:74, 10:42] = 255
    target[10:74, 10:13] = 255
    target[10:74, 39:42] = 255
    reference = engine.sessions.get(token)["reference"]
    decoy = choose_appearance(reference, target)
    assert decoy["status"] == "matched"
    assert confirm_region(reference, target, decoy["box"])["status"] == "searching"

    assert engine.match(token, target)["status"] == "searching"
    result = engine.match(token, target)
    assert result["status"] == "matched"
    assert np.allclose(result["box"], expected)


def test_blurry_visual_prompt_can_use_generic_proposals_without_category_matching():
    import torch

    engine, token, _, target, expected = setup_case()
    engine.visual.predict = lambda *args, **kwargs: [SimpleNamespace(boxes=[])]
    # A busy frame has many detections. Only the selected object's immutable
    # colour/shape evidence qualifies for the expensive identity checks.
    boxes = [[0.0, 0.0, 100.0, 80.0]] * 8 + [[260.0, 100.0, 356.0, 292.0]]
    detections = [
        SimpleNamespace(xyxy=torch.tensor([box]), conf=torch.tensor([0.7])) for box in boxes
    ]
    engine.detector = SimpleNamespace(
        predict=lambda *args, **kwargs: [SimpleNamespace(boxes=detections)]
    )
    assert engine.match(token, target)["status"] == "searching"
    result = engine.match(token, target)
    assert result["status"] == "matched"
    assert np.allclose(result["box"], expected)


def test_too_many_quality_candidates_cannot_lock_by_verifying_only_a_subset():
    from matching import Candidate

    engine, token, _, target, box = setup_case()
    acquisition = engine.sessions.get(token)["cross_acquisition"]
    result = acquisition.update(target, [Candidate(tuple(box), 0.7)] * 6, float("inf"))
    assert result["status"] == "ambiguous"
    assert acquisition.pending is None


@pytest.mark.parametrize("generic", [False, True])
def test_proposal_beyond_the_first_five_still_prevents_a_false_lock(monkeypatch, generic):
    from collections import deque

    import torch

    monkeypatch.setattr("engine.time.monotonic", lambda: 0.0)
    engine, token, _, target, first = setup_case()
    target[100:292, 140:236] = target[100:292, 260:356]
    second = [140 / 480, 100 / 360, 236 / 480, 292 / 360]
    engine.segmentation.predictions = deque([(first, 0.99, 0.95), (second, 0.99, 0.95)] * 3)
    engine.visual.predict = lambda *args, **kwargs: [SimpleNamespace(boxes=[])]
    boxes = [[260.0, 100.0, 356.0, 292.0]] + [[0.0, 0.0, 100.0, 80.0]] * 4
    boxes.append([140.0, 100.0, 236.0, 292.0])
    detections = [
        SimpleNamespace(xyxy=torch.tensor([box]), conf=torch.tensor([0.7])) for box in boxes
    ]
    engine.detector = SimpleNamespace(
        predict=lambda *args, **kwargs: [SimpleNamespace(boxes=detections)]
    )
    engine.visual.predict = lambda *args, **kwargs: [
        SimpleNamespace(boxes=[] if generic else detections)
    ]

    # Isolate the expensive feature extraction boundary: global comparison has
    # insufficient corners, while either local proposal geometrically matches.
    def compare(image, candidate):
        for box in (first, second):
            if np.allclose(candidate.box, box):
                return {"box": box, "score": 0.96, "inliers": 18}
        return None

    engine.sessions.get(token)["reference"].compare = compare
    assert engine.match(token, target)["status"] == "ambiguous"
    assert engine.sessions.get(token)["target"] is None
