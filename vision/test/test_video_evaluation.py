import pytest

from evaluate_video import overlap, validate_cases


def test_case_paths_and_time_ranges_are_validated_before_writing_outputs():
    valid = {
        "name": "hand-open",
        "start": 1,
        "end": 3,
        "box": [0.1, 0.2, 0.4, 0.6],
        "truth": {"2": [0.1, 0.2, 0.4, 0.6]},
    }
    assert validate_cases([valid], 10)[0]["name"] == "hand-open"
    for updates in [
        {"name": "../private"},
        {"end": 11},
        {"start": 4},
        {"truth": {"8": [0.1, 0.2, 0.4, 0.6]}},
    ]:
        with pytest.raises(ValueError):
            validate_cases([{**valid, **updates}], 10)


def test_accuracy_uses_independent_ground_truth_overlap_and_counts_missing_boxes():
    assert overlap([0, 0, 0.5, 1], [0.25, 0, 0.75, 1]) == pytest.approx(1 / 3)
    assert overlap(None, [0, 0, 0.5, 1]) == 0


def test_annotated_frames_are_evaluated_even_between_sampling_ticks():
    from evaluate_video import analyzed_frame

    assert analyzed_frame(2, 0, 3, {2: [0, 0, 0.5, 1]})
    assert analyzed_frame(3, 0, 3, {})
    assert not analyzed_frame(2, 0, 3, {})


def test_multiple_truth_annotations_rounding_to_one_frame_are_all_retained():
    from evaluate_video import checkpoint_frames

    truth = {".05": [0, 0, 0.5, 1], ".06": [0, 0, 0.5, 1]}
    checkpoints = checkpoint_frames(truth, 30)
    assert sum(map(len, checkpoints.values())) == len(truth)
    assert len(checkpoints[2]) == 2


def test_case_evaluation_accounts_for_each_annotation_through_the_real_loop(monkeypatch, tmp_path):
    from types import SimpleNamespace

    import numpy as np

    import evaluate_video as module

    box = [0.2, 0.2, 0.5, 0.6]
    video = SimpleNamespace(
        set=lambda *args: None,
        get=lambda *args: 4,
        read=lambda: (True, np.full((60, 80, 3), 100, np.uint8)),
    )
    engine = SimpleNamespace(
        select=lambda *args: {"token": "test"},
        track=lambda *args: {"status": "matched", "box": box},
        match=lambda *args: {"status": "searching"},
        clear=lambda *args: None,
    )
    writer = SimpleNamespace(isOpened=lambda: True, write=lambda *args: None, release=lambda: None)
    monkeypatch.setattr(module.cv2, "VideoWriter", lambda *args: writer)
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: None)
    case = {"name": "sample", "start": 0, "end": 0.1, "box": box, "truth": {".05": box, ".06": box}}
    summary = module.run_case(engine, video, 30, case, tmp_path)
    assert summary["checkpointCount"] == 2
    assert [item["time"] for item in summary["checkpoints"]] == [0.05, 0.06]
    assert summary["sceneCheckpointSuccessFraction"] == 1
    assert summary["targetCheckpointSuccessFraction"] == 0


def test_default_target_feed_uses_identical_pixels_without_a_target_selection(
    monkeypatch, tmp_path
):
    from types import SimpleNamespace

    import numpy as np

    import evaluate_video as module

    image = np.arange(60 * 80 * 3, dtype=np.uint8).reshape(60, 80, 3)
    box = [0.2, 0.2, 0.5, 0.6]
    captured = {"scene": [], "target": []}

    class EngineBoundary:
        def select(self, frame, point, rectangle):
            assert rectangle == box
            return {"token": "scene-only-selection"}

        def track(self, token, frame):
            captured["scene"].append(frame.copy())
            return {"status": "matched", "box": box}

        def match(self, token, frame):
            # The real match API receives a token and pixels, never a Target box.
            captured["target"].append(frame.copy())
            return {"status": "searching"}

        def clear(self, token):
            pass

    video = SimpleNamespace(set=lambda *args: None, get=lambda *args: 4, read=lambda: (True, image))
    writer = SimpleNamespace(isOpened=lambda: True, write=lambda *args: None, release=lambda: None)
    monkeypatch.setattr(module.cv2, "VideoWriter", lambda *args: writer)
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: None)
    case = {"name": "same-video", "start": 0, "end": 0.3, "box": box, "truth": {"0": box}}
    result = module.run_case(EngineBoundary(), video, 10, case, tmp_path, analysis_fps=5)
    for scene, target in zip(captured["scene"], captured["target"], strict=True):
        np.testing.assert_array_equal(target, scene)
    assert result["targetMode"] == "same-video"
    assert result["analyzedFrames"] == 3
    assert result["lastAnalyzedTime"] == 0.3
    assert result["targetFirstAcquiredTime"] is None


def test_acquisition_timeline_records_loss_and_recovery_without_hiding_gaps():
    from evaluate_video import status_events

    rows = [
        {"time": 6.0, "target": {"status": "searching"}},
        {"time": 6.1, "target": {"status": "matched"}},
        {"time": 6.2, "target": {"status": "matched"}},
        {"time": 6.3, "target": {"status": "searching"}},
        {"time": 6.4, "target": {"status": "ambiguous"}},
        {"time": 6.5, "target": {"status": "matched"}},
    ]
    assert status_events(rows, "target") == [
        {"time": 6.0, "status": "searching"},
        {"time": 6.1, "status": "matched"},
        {"time": 6.3, "status": "searching"},
        {"time": 6.4, "status": "ambiguous"},
        {"time": 6.5, "status": "matched"},
    ]


def test_video_decode_failure_does_not_produce_a_partial_success_report(monkeypatch, tmp_path):
    from types import SimpleNamespace

    import numpy as np

    import evaluate_video as module

    reads = iter([(True, np.full((60, 80, 3), 100, np.uint8)), (False, None)])
    box = [0.2, 0.2, 0.5, 0.6]
    video = SimpleNamespace(set=lambda *args: None, get=lambda *args: 3, read=lambda: next(reads))
    engine = SimpleNamespace(
        select=lambda *args: {"token": "test"},
        track=lambda *args: {"status": "matched", "box": box},
        match=lambda *args: {"status": "searching"},
        clear=lambda *args: None,
    )
    writer = SimpleNamespace(isOpened=lambda: True, write=lambda *args: None, release=lambda: None)
    monkeypatch.setattr(module.cv2, "VideoWriter", lambda *args: writer)
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: None)
    case = {"name": "decode-failure", "start": 0, "end": 0.2, "box": box}
    with pytest.raises(ValueError, match="Cannot decode.*frame"):
        module.run_case(engine, video, 10, case, tmp_path, analysis_fps=10)
    assert not (tmp_path / "decode-failure.json").exists()


def test_full_clip_end_is_bounded_to_the_last_real_frame(monkeypatch, tmp_path):
    from types import SimpleNamespace

    import numpy as np

    import evaluate_video as module

    frames = iter([(True, np.full((60, 80, 3), 100, np.uint8))] * 3 + [(False, None)])
    video = SimpleNamespace(set=lambda *args: None, get=lambda *args: 3, read=lambda: next(frames))
    box = [0.2, 0.2, 0.5, 0.6]
    engine = SimpleNamespace(
        select=lambda *args: {"token": "test"},
        track=lambda *args: {"status": "matched", "box": box},
        match=lambda *args: {"status": "searching"},
        clear=lambda *args: None,
    )
    writer = SimpleNamespace(isOpened=lambda: True, write=lambda *args: None, release=lambda: None)
    monkeypatch.setattr(module.cv2, "VideoWriter", lambda *args: writer)
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: None)
    case = {"name": "full-clip", "start": 0, "end": 0.3, "box": box}
    result = module.run_case(engine, video, 10, case, tmp_path, analysis_fps=10)
    assert result["analyzedFrames"] == 3
    assert result["lastAnalyzedTime"] == 0.2
