"""Small-object acquisition policy; real inference is checked in local replay."""

from types import SimpleNamespace

import numpy as np
import pytest
from test_memory_tracking import SegmentationBoundary

from context_acquisition import AcquiredRegion, ContextAcquisition
from matching import Reference
from memory_tracking import MemoryTracker


def fixture(predictions=None):
    scene = np.random.default_rng(73).integers(0, 255, (150, 200, 3), dtype=np.uint8)
    box = [80 / 200, 60 / 150, 96 / 200, 84 / 150]
    target = scene.copy()
    target[60:84, 80:83] = 255 - target[60:84, 80:83]
    reference = Reference(scene, box)
    backend = SegmentationBoundary(predictions or [(box, 0.99, 0.95)] * 4)
    backend.similarity = lambda *args: 0.9
    clock = [0.0]
    context = ContextAcquisition(scene, box, reference, {"frame": 0}, backend, lambda: clock[0])
    return context, target, box, clock


@pytest.mark.parametrize(
    "presence,quality,similarity",
    [
        (0.8, 0.95, 0.9),
        (0.99, 0.7, 0.9),
        (0.99, 0.95, 0.65),
        (float("nan"), 0.95, 0.9),
        (0.99, 1.1, 0.9),
        (0.99, 0.95, float("nan")),
    ],
)
def test_matching_background_cannot_substitute_for_mask_evidence(presence, quality, similarity):
    context, target, box, _ = fixture()
    context.backend = SegmentationBoundary([(box, presence, quality)] * 2)
    context.backend.similarity = lambda *args: similarity
    for _ in range(2):
        assert context.update(target) == {"status": "searching"}
        assert context.pending is None


@pytest.mark.parametrize("box", [None, [0, 0, 1, 1], [0.7, 0.6, 0.8, 0.8]])
def test_absent_or_wrong_region_cannot_lock_from_matching_context(box):
    context, target, _, _ = fixture([(box, 0.99, 0.95)] * 2)
    for _ in range(2):
        assert context.update(target) == {"status": "searching"}
        assert context.pending is None


def test_duplicate_context_clears_confirmation_without_mask_inference():
    context, target, _, _ = fixture()
    assert context.update(target)["status"] == "searching"
    assert context.pending is not None
    remaining = len(context.backend.predictions)
    duplicate = np.concatenate([target, target], axis=1)
    assert context.update(duplicate)["status"] == "ambiguous"
    assert context.pending is None
    assert len(context.backend.predictions) == remaining


@pytest.mark.parametrize("reset", ["time", "stream", "absence"])
def test_confirmation_cannot_survive_expiry_reset_or_absence(reset):
    context, target, _, clock = fixture()
    assert context.update(target)["status"] == "searching"
    if reset == "time":
        clock[0] = 2
    elif reset == "stream":
        context.reset()
    else:
        assert context.update(np.zeros_like(target))["status"] == "searching"
    assert context.update(target)["status"] == "searching"
    assert context.update(target)["status"] == "matched"


def test_two_masks_must_agree_with_each_other_as_well_as_scene():
    context, target, _, _ = fixture()
    scores = iter([0.9, 0.9, 0.4])
    context.backend.similarity = lambda *args: next(scores)
    assert context.update(target)["status"] == "searching"
    assert context.update(target)["status"] == "searching"


def test_attempts_never_commit_candidate_outputs_to_scene_memory():
    context, target, box, _ = fixture()

    def predict(image, prompt, index, outputs):
        assert prompt is None
        assert outputs == {"cond_frame_outputs": {0: context.anchor}, "non_cond_frame_outputs": {}}
        return SimpleNamespace(box=box, presence=0.99, quality=0.95, memory={"new": index})

    context.backend.predict = predict
    assert context.update(target)["status"] == "searching"
    assert context.update(target)["status"] == "matched"
    assert context.anchor == {"frame": 0}


@pytest.mark.parametrize("mismatch", ["frame", "reference", "region"])
def test_context_evidence_cannot_be_reused_for_another_acquisition(mismatch):
    context, target, box, _ = fixture()
    evidence = AcquiredRegion(context.reference, target, box)
    image, reference, region = target, context.reference, box
    if mismatch == "frame":
        image = target.copy()
    elif mismatch == "reference":
        reference = Reference(context.reference.image, [0, 0, 1, 1])
    else:
        region = [0.7, 0.6, 0.8, 0.8]
    with pytest.raises(ValueError, match="original selected object"):
        MemoryTracker(
            image,
            region,
            reference=reference,
            backend=SegmentationBoundary([]),
            acquisition=evidence,
        )


def test_nearby_duplicate_contexts_are_ambiguous_at_object_scale():
    periodic = np.tile(
        np.random.default_rng(17).integers(0, 255, (72, 20, 3), dtype=np.uint8), (1, 8, 1)
    )
    scene = np.full((150, 200, 3), 170, np.uint8)
    scene[36:108, 36:164] = periodic[:, :128]
    box = [80 / 200, 60 / 150, 96 / 200, 84 / 150]
    target = np.full((200, 300, 3), 170, np.uint8)
    target[30:102, 30:114] = periodic[:, :84]
    context = ContextAcquisition.create(
        scene, box, Reference(scene, box), {}, SegmentationBoundary([])
    )
    assert context.update(target)["status"] == "ambiguous"
