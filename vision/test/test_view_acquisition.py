"""Real geometry and acquisition policy; replace only expensive model inference."""

from types import SimpleNamespace

import numpy as np
import pytest

from matching import Candidate, Reference

SOURCE = [0.25, 0.25, 0.75, 0.75]
TARGET = [0.35, 0.15, 0.85, 0.65]


def make_case(source_memory=None, color=(90, 90, 90)):
    import torch

    from view_acquisition import ViewAcquisition

    image = np.full((320, 320, 3), color, np.uint8)
    reference = Reference(image, SOURCE)

    class Matcher:
        def encode(self, image):
            return image

        def match_encoded(self, source, target):
            h, w = source.shape[:2]
            # The original selection is centred within either bounded context.
            span = 160 / w
            low = (1 - span) / 2
            points = np.array(
                [[x, y] for y in (0.1, 0.4, 0.7, 0.9) for x in (0.1, 0.5, 0.9)], np.float32
            )
            return low + points * span, np.array([0.35, 0.15]) + points * 0.5

    class Backend:
        quality = 0.95
        presence = 0.99

        def predict(self, image, box, index, outputs):
            return SimpleNamespace(
                box=TARGET.copy(),
                presence=self.presence,
                quality=self.quality,
                memory={"object": 1, "pred_masks": torch.ones((1, 1, 128, 128))},
            )

        def similarity(self, candidate, anchor):
            return 0.95

    matcher = Matcher()
    backend = Backend()
    acquisition = ViewAcquisition(
        image,
        SOURCE,
        reference,
        matcher,
        backend,
        source_memory=source_memory or {"pred_masks": torch.ones((1, 1, 128, 128))},
    )
    acquisition.clock = lambda: 0.0
    return acquisition, matcher, backend, image, [Candidate(tuple(TARGET), 0.6)], reference


def test_cross_view_geometry_initializes_only_after_two_object_observations():
    acquisition, _, _, image, candidates, reference = make_case()
    assert acquisition.update(image, candidates)["status"] == "searching"
    result = acquisition.update(image, candidates)
    assert result["status"] == "matched"
    assert result["box"] == TARGET
    assert result["acquisition"].reference is reference
    assert result["acquisition"].image is image


def test_background_correspondences_cannot_confirm_selected_object():
    acquisition, matcher, _, image, candidates, _ = make_case()
    matcher.match_encoded = lambda *args: (np.zeros((12, 2)), np.full((12, 2), 0.5))
    for _ in range(3):
        assert acquisition.update(image, candidates)["status"] == "searching"


@pytest.mark.parametrize("bad", ["few", "line", "reused", "nan"])
def test_insufficient_or_invalid_object_geometry_cannot_lock(bad):
    acquisition, matcher, _, image, candidates, _ = make_case()
    points = np.array([[x, y] for y in (0.3, 0.5, 0.7) for x in (0.3, 0.5, 0.7)])
    if bad == "few":
        points = points[:7]
    if bad == "line":
        points[:, 1] = 0.5
    if bad == "reused":
        points[:] = 0.5
    if bad == "nan":
        points[0, 0] = float("nan")
    matcher.match_encoded = lambda *args: (points, points + [0.1, -0.1])
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "searching"


@pytest.mark.parametrize("quality,presence", [(0.4, 0.99), (0.95, 0.4), (float("nan"), 0.99)])
def test_weak_or_invalid_target_masks_do_not_establish_identity(quality, presence):
    acquisition, _, backend, image, candidates, _ = make_case()
    backend.quality, backend.presence = quality, presence
    for _ in range(2):
        assert acquisition.update(image, candidates)["status"] == "searching"


def test_missing_frame_discards_pending_object_confirmation():
    acquisition, _, _, image, candidates, _ = make_case()
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, [])["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "matched"


def test_changed_camera_dimensions_require_new_confirmation():
    acquisition, _, _, image, candidates, _ = make_case()
    assert acquisition.update(image, candidates)["status"] == "searching"
    changed = np.full((240, 320, 3), 90, np.uint8)
    assert acquisition.update(changed, candidates)["status"] == "searching"
    assert acquisition.update(changed, candidates)["status"] == "matched"


def test_reset_discards_pending_confirmation():
    acquisition, _, _, image, candidates, _ = make_case()
    assert acquisition.update(image, candidates)["status"] == "searching"
    acquisition.reset()
    assert acquisition.update(image, candidates)["status"] == "searching"


def test_model_failure_consumes_pending_confirmation():
    acquisition, matcher, _, image, candidates, _ = make_case()
    assert acquisition.update(image, candidates)["status"] == "searching"
    original = matcher.match_encoded

    def fail(*args):
        raise RuntimeError("inference failed")

    matcher.match_encoded = fail
    with pytest.raises(RuntimeError):
        acquisition.update(image, candidates)
    matcher.match_encoded = original
    assert acquisition.update(image, candidates)["status"] == "searching"


def test_duplicate_hidden_by_mutual_matching_is_detected_by_second_search():
    acquisition, matcher, _, image, candidates, _ = make_case()
    original = matcher.match_encoded

    def points(source, target):
        a, b = original(source, target)
        if np.any(target == 0):
            b = (b - [0.35, 0.15]) * 0.4 + [0.05, 0.1]
        return a, b

    matcher.match_encoded = points
    assert acquisition.update(image, candidates)["status"] == "ambiguous"
    assert acquisition.pending is None


def test_expired_confirmation_requires_two_new_observations():
    acquisition, _, _, image, candidates, _ = make_case()
    clock = [0.0]
    acquisition.clock = lambda: clock[0]
    assert acquisition.update(image, candidates)["status"] == "searching"
    clock[0] = 3.0
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "matched"


def test_exhausted_inference_budget_consumes_old_confirmation(monkeypatch):
    acquisition, _, _, image, candidates, _ = make_case()
    assert acquisition.update(image, candidates)["status"] == "searching"
    with monkeypatch.context() as patch:
        clock = iter([0.0, 3.0])
        patch.setattr("view_acquisition.time.monotonic", lambda: next(clock))
        assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "searching"


def engine_case():
    import torch
    from test_cross_camera import setup_case

    from view_acquisition import ViewAcquisition

    engine, token, scene, target, box = setup_case()
    selected = engine.sessions.get(token)
    # Isolate learned scheduling from separately tested coarse quality acquisition.
    selected["cross_acquisition"].appearance = None
    wrong = SimpleNamespace(xyxy=torch.tensor([[0.0, 0.0, 100.0, 80.0]]), conf=torch.tensor([0.9]))
    correct = SimpleNamespace(
        xyxy=torch.tensor([[260.0, 100.0, 356.0, 292.0]]), conf=torch.tensor([0.7])
    )
    engine.visual.predict = lambda *args, **kwargs: [SimpleNamespace(boxes=[wrong])]
    engine.detector = SimpleNamespace(
        predict=lambda *args, **kwargs: [SimpleNamespace(boxes=[correct])]
    )

    class Matcher:
        def encode(self, image):
            return image

        def match_encoded(self, source, target):
            ys, xs = np.where(np.any(source != 90, axis=-1))
            low = np.array([xs.min() / source.shape[1], ys.min() / source.shape[0]])
            high = np.array([(xs.max() + 1) / source.shape[1], (ys.max() + 1) / source.shape[0]])
            grid = np.array([[x, y] for y in (0.1, 0.4, 0.7, 0.9) for x in (0.1, 0.5, 0.9)])
            return low + grid * (high - low), np.array(box[:2]) + grid * (
                np.array(box[2:]) - box[:2]
            )

    selected["view_acquisition"] = ViewAcquisition(
        scene,
        [80 / 240, 60 / 180, 112 / 240, 124 / 180],
        selected["reference"],
        Matcher(),
        engine.segmentation,
        source_memory={"pred_masks": torch.ones((1, 1, 128, 128))},
    )
    original_predict = engine.segmentation.predict

    def masked_predict(*args):
        result = original_predict(*args)
        result.memory["pred_masks"] = torch.ones((1, 1, 128, 128))
        return result

    engine.segmentation.predict = masked_predict
    selected["view_acquisition"].clock = lambda: 0.0
    return engine, token, target, box, selected


def test_unrelated_visual_proposal_does_not_block_generic_cross_view_search():
    engine, token, target, box, selected = engine_case()
    assert engine.match(token, target)["status"] == "searching"
    result = engine.match(token, target)
    assert result["status"] == "matched"
    assert result["box"] == box
    assert selected["target"].reference is selected["reference"]
    assert selected["scene"].active


def test_duplicate_search_uses_the_same_blur_tolerance_as_initial_acquisition():
    acquisition, matcher, _, image, candidates, _ = make_case()
    original = matcher.match_encoded

    def points(source, target):
        a, b = original(source, target)
        if np.any(target == 0):
            b = b - [0.33, 0.13]
            noise = np.array(
                [
                    [0.012, -0.014],
                    [-0.015, 0.012],
                    [0.011, 0.015],
                    [-0.014, -0.011],
                    [0.014, 0.014],
                    [-0.012, -0.016],
                    [0.015, -0.014],
                    [-0.013, 0.013],
                    [0.012, 0.012],
                    [-0.014, -0.012],
                    [0.016, 0.015],
                    [-0.013, -0.014],
                ]
            )
            b = b + noise
        return a, b

    matcher.match_encoded = points
    assert acquisition.update(image, candidates)["status"] == "ambiguous"


def test_background_inside_target_rectangle_is_not_object_evidence():
    import torch

    acquisition, _, backend, image, candidates, _ = make_case()
    original = backend.predict

    def predict(*args):
        result = original(*args)
        # Foreground only occupies a small corner of the proposed rectangle.
        mask = torch.full((1, 1, 128, 128), -10.0)
        mask[:, :, 20:26, 46:52] = 10.0
        result.memory["pred_masks"] = mask
        return result

    backend.predict = predict
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "searching"


def test_two_remaining_duplicates_do_not_cancel_each_others_geometric_support():
    acquisition, matcher, _, image, candidates, _ = make_case()
    original = matcher.match_encoded

    def points(source, target):
        a, b = original(source, target)
        if np.any(target == 0):
            # Different source samples avoid duplicated-source shortcuts.
            a2 = a + [0.008, 0.006]
            b1 = (b - [0.35, 0.15]) * 0.4 + [0.04, 0.04]
            b2 = (b - [0.35, 0.15]) * 0.4 + [0.72, 0.73]
            return np.concatenate([a, a2]), np.concatenate([b1, b2])
        return a, b

    matcher.match_encoded = points
    assert acquisition.update(image, candidates)["status"] == "ambiguous"


def test_background_inside_source_selection_does_not_establish_identity():
    import torch

    mask = torch.full((1, 1, 128, 128), -10.0)
    mask[:, :, 32:38, 32:38] = 10.0
    acquisition, _, _, image, candidates, _ = make_case({"pred_masks": mask})
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "searching"


def test_engine_camera_generation_discards_pending_cross_view_evidence():
    engine, token, target, _, selected = engine_case()
    assert engine.match(token, target, stream=0)["status"] == "searching"
    assert selected["view_acquisition"].pending is not None
    assert engine.match(token, target, stream=1)["status"] == "searching"
    assert engine.match(token, target, stream=1)["status"] == "matched"


def test_engine_proposal_error_discards_pending_cross_view_evidence():
    engine, token, target, _, selected = engine_case()
    assert engine.match(token, target)["status"] == "searching"
    original = engine.detector.predict

    def fail(*args, **kwargs):
        raise RuntimeError("proposal failed")

    engine.detector.predict = fail
    with pytest.raises(RuntimeError, match="proposal failed"):
        engine.match(token, target)
    assert selected["view_acquisition"].pending is None
    engine.detector.predict = original
    assert engine.match(token, target)["status"] == "searching"
    assert engine.match(token, target)["status"] == "matched"


def test_high_geometric_scores_cannot_override_contradictory_object_colour():
    acquisition, _, _, image, candidates, _ = make_case(color=(180, 60, 15))
    wrong = image.copy()
    wrong[:] = (15, 60, 180)
    assert acquisition.update(wrong, candidates)["status"] == "searching"
    assert acquisition.update(wrong, candidates)["status"] == "searching"


def test_source_encoding_is_reused_after_confirmation_reset_but_target_is_fresh():
    acquisition, matcher, _, image, candidates, _ = make_case()
    calls = []

    def encode(pixels):
        calls.append(pixels)
        return pixels.copy()

    matcher.encode = encode
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert acquisition.update(image, candidates)["status"] == "matched"
    acquisition.reset()
    assert acquisition.update(image, candidates)["status"] == "searching"
    assert sum(pixels is acquisition.contexts[0][0] for pixels in calls) == 1
    assert sum(pixels is image for pixels in calls) == 3
    assert sum(np.any(pixels == 0) for pixels in calls) == 3


def test_target_encoding_is_shared_across_source_contexts_only_within_one_observation():
    acquisition, matcher, _, image, candidates, _ = make_case()
    calls = []
    matcher.encode = lambda pixels: calls.append(pixels) or pixels.copy()
    matcher.match_encoded = lambda *args: (np.empty((0, 2)), np.empty((0, 2)))
    for _ in range(2):
        assert acquisition.update(image, candidates)["status"] == "searching"
    assert sum(pixels is image for pixels in calls) == 2
    for source, _, _ in acquisition.contexts:
        assert sum(pixels is source for pixels in calls) == 1


def test_engine_new_stream_prioritizes_cross_view_before_visual_prompt_search(monkeypatch):
    engine, token, target, box, selected = engine_case()
    monkeypatch.setattr("engine.choose_match", lambda *args, **kwargs: {"status": "searching"})
    monkeypatch.setattr("engine.choose_appearance", lambda *args, **kwargs: {"status": "searching"})

    def slow_search(*args, **kwargs):
        pytest.fail("legacy visual prompt search preceded the cross-view candidate")

    engine.visual.predict = slow_search
    assert engine.match(token, target)["status"] == "searching"
    result = engine.match(token, target)
    assert result["status"] == "matched"
    assert result["box"] == box
    assert selected["scene"].active


def test_pending_cross_view_confirmation_skips_older_context_search():
    engine, token, target, _, selected = engine_case()
    selected["stream"] = 0
    view = selected["view_acquisition"]
    assert (
        view.update(target, engine.candidates(engine.detector.predict(target)[0], target))["status"]
        == "searching"
    )
    selected["view_search"] = True

    def older_context(*args):
        pytest.fail("already verified cross-view candidate repeated older context search")

    selected["context_acquisition"].update = older_context
    assert engine.match(token, target)["status"] == "matched"


def test_pending_legacy_context_gets_its_confirmation_without_learned_interruption():
    from context_acquisition import AcquiredRegion

    engine, token, target, box, selected = engine_case()
    selected["stream"] = 0
    selected["view_search"] = False
    observed = []
    context = SimpleNamespace(pending=None)

    def update(image):
        observed.append(image)
        if len(observed) == 1:
            context.pending = object()
            return {"status": "searching"}
        prediction = engine.segmentation.predict(image, box, 0, {})
        return {
            "status": "matched",
            "box": box,
            "score": 0.99,
            "acquisition": AcquiredRegion(selected["reference"], image, box, prediction),
        }

    context.update = update
    context.reset = lambda: setattr(context, "pending", None)
    selected["context_acquisition"] = context
    engine.find = lambda *args, **kwargs: {"status": "searching"}
    assert engine.match(token, target)["status"] == "searching"
    assert engine.match(token, target)["status"] == "matched"
    assert len(observed) == 2


def test_repeated_learned_confirmation_disagreement_cannot_starve_legacy_search(monkeypatch):
    engine, token, target, _, selected = engine_case()
    engine.segmentation.similarity = lambda *args: 0.5
    monkeypatch.setattr("engine.choose_match", lambda *args, **kwargs: {"status": "searching"})
    monkeypatch.setattr("engine.choose_appearance", lambda *args, **kwargs: {"status": "searching"})
    observed = []
    selected["context_acquisition"].update = lambda image: (
        observed.append(image) or {"status": "searching"}
    )
    for _ in range(3):
        assert engine.match(token, target)["status"] == "searching"
    assert len(observed) == 1
    assert selected["target"] is None


def test_existing_quality_match_uses_generic_proposals_before_heavier_cross_view(monkeypatch):
    engine, token, target, box, selected = engine_case()
    selected["cross_acquisition"].appearance = engine.appearance
    monkeypatch.setattr("engine.choose_match", lambda *args, **kwargs: {"status": "searching"})
    monkeypatch.setattr("engine.choose_appearance", lambda *args, **kwargs: {"status": "searching"})

    def unnecessary_transformer(*args):
        pytest.fail("repeated heavy matching for an independently verified quality candidate")

    selected["view_acquisition"].matcher.match_encoded = unnecessary_transformer
    assert engine.match(token, target)["status"] == "searching"
    assert selected["cross_acquisition"].pending is not None
    assert engine.match(token, target)["status"] == "matched"
    assert selected["target"].reference is selected["reference"]
    assert box == selected["target"].box
