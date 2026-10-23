"""Opt-in engine contracts: safe setup, matching visual preparation and bounded inference."""

import importlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
import torch

from sightline_speaker import assets, faces, model
from sightline_speaker.audio import extract_track
from sightline_speaker.faces import FaceObservation, FaceTrack
from sightline_speaker.media import DecodedMedia
from sightline_speaker.settings import Settings


def av_api():
    try:
        return importlib.import_module("sightline_speaker.av_model")
    except ModuleNotFoundError as exc:
        pytest.fail(f"Opt-in AV-MossFormer2 boundary is missing: {exc}")


def sample_media(seconds=2):
    count = round(seconds * 25)
    image = np.zeros((256, 256, 3), np.uint8)
    image[..., 0] = np.arange(256, dtype=np.uint8)[:, None]
    image[..., 1] = np.arange(256, dtype=np.uint8)[None, :]
    media = DecodedMedia(
        Path("unused"),
        np.full(round(seconds * 16000), 0.2, np.float32),
        [image] * count,
        np.arange(count) / 25,
        256,
        256,
        seconds,
    )
    observations = [
        FaceObservation(t, (0.375, 0.375, 0.25, 0.25), np.zeros((5, 2)), np.array([128, 144]))
        for t in media.timestamps
    ]
    return media, FaceTrack("selected", observations)


def test_engine_settings_reject_unknown_and_default_to_av_mossformer():
    assert Settings().engine == "av-mossformer2"
    assert Settings().asset_dir == Path("data/av-assets")
    assert Settings(engine="rtfs").asset_dir == Path("data/assets")
    assert Settings(engine="av-mossformer2").engine == "av-mossformer2"
    with pytest.raises(ValueError, match="engine"):
        Settings(engine="implicit-download-model")


def test_factory_dispatches_explicit_engine_and_rejects_unknown(tmp_path, monkeypatch):
    av = av_api()
    factory = getattr(model, "load_separator", None)
    assert factory is not None, "Missing explicit engine factory"
    monkeypatch.setattr(model.Separator, "load", lambda *_: SimpleNamespace(engine_key="rtfs"))
    monkeypatch.setattr(
        av.AvMossFormerSeparator, "load", lambda *_: SimpleNamespace(engine_key="av-mossformer2")
    )
    assert factory(tmp_path, "cpu").engine_key == "av-mossformer2"
    assert factory(tmp_path, "cpu", "rtfs").engine_key == "rtfs"
    assert factory(tmp_path, "cpu", "av-mossformer2").engine_key == "av-mossformer2"
    with pytest.raises(ValueError, match="engine"):
        factory(tmp_path, "cpu", "other")


def test_cli_passes_explicit_engine_to_settings(monkeypatch):
    from sightline_speaker import __main__ as cli

    received = []
    monkeypatch.setattr(cli, "create_app", lambda settings: settings)
    monkeypatch.setattr(cli.uvicorn, "run", lambda app, **_: received.append(app))
    monkeypatch.setattr(
        "sys.argv", ["sightline-speaker", "--engine", "av-mossformer2", "--assets", "data/av"]
    )
    cli.main()
    assert received[0].engine == "av-mossformer2"
    assert received[0].asset_dir == Path("data/av")


@pytest.mark.parametrize(
    "args,engine,directory",
    [
        ([], "av-mossformer2", "data/av-assets"),
        (["--engine", "rtfs"], "rtfs", "data/assets"),
    ],
)
def test_cli_loads_the_matching_default_assets(args, engine, directory, monkeypatch):
    from sightline_speaker import __main__ as cli

    received = []
    monkeypatch.setattr(cli, "create_app", lambda settings: settings)
    monkeypatch.setattr(cli.uvicorn, "run", lambda app, **_: received.append(app))
    monkeypatch.setattr("sys.argv", ["sightline-speaker", *args])
    cli.main()
    assert received[0].engine == engine
    assert received[0].asset_dir == Path(directory)


@pytest.mark.asyncio
async def test_av_live_inference_waits_for_its_full_model_context(tmp_path):
    from time import monotonic

    from sightline_speaker.jobs import Store
    from sightline_speaker.live import LiveConfig, LiveSession

    owner = Store(
        Settings(data_dir=tmp_path, engine="av-mossformer2"), start_worker=False, load_model=False
    )
    session = LiveSession(
        owner,
        LiveConfig.model_validate(
            dict(
                type="configure",
                protocol_version=3,
                sample_rate=16000,
                audio=True,
                source="network",
                sync_verified=True,
                video_offset_ms=0,
                client_time=monotonic(),
            )
        ),
    )
    try:
        for sample in range(0, 48000, 640):
            session.buffer.frame(sample, np.zeros((8, 8, 3), np.uint8))
        session.buffer.audio(0, 10, np.zeros(1920, np.float32))
        assert session.buffer.window() is None
        session.buffer.audio(1920, 10.12, np.zeros(46080, np.float32))
        window = session.buffer.window()
        assert window.audio.size == 48000
        assert window.valid_samples == 48000
        assert window.emit_start_sample is None
        assert session.buffer.start_sample == 28800
    finally:
        await session.close()
        owner.close()


def test_av_face_preparation_matches_official_lower_face_crop():
    prepare = getattr(faces, "prepare_frames", None)
    assert prepare is not None, "Missing shared engine-specific preprocessing"
    media, track = sample_media()
    actual = prepare(media, track, 0, 2, "av-mossformer2")
    # Hand-derived official bbox: center128, radius32, expansion0.4 => this crop.
    face = cv2.resize(media.frames[0][96:185, 83:172], (224, 224))
    expected = (cv2.cvtColor(face, cv2.COLOR_RGB2GRAY)[56:168, 56:168] / 255 - 0.4161) / 0.1688
    assert actual.shape == (50, 112, 112) and actual.dtype == np.float32
    np.testing.assert_allclose(actual[0], expected, atol=1e-6)
    np.testing.assert_array_equal(actual[-1], actual[0])


def test_av_preparation_preserves_internal_face_loss_and_eof_padding():
    prepare = getattr(faces, "prepare_frames", None)
    assert prepare is not None, "Missing shared engine-specific preprocessing"
    media, track = sample_media(0.4)
    output = prepare(media, track, 0, 2, "av-mossformer2")
    assert output.shape == (50, 112, 112)
    np.testing.assert_array_equal(output[-1], output[9])
    media, track = sample_media(3)
    track.observations = track.observations[:5] + track.observations[-5:]
    with pytest.raises(ValueError, match="lost"):
        prepare(media, track, 0, 2, "av-mossformer2")


class IdentityModel(torch.nn.Module):
    def forward(self, audio, visual):
        return audio


@pytest.mark.parametrize(
    "audio,frames",
    [
        (np.zeros(0), np.zeros((0, 112, 112))),
        (np.zeros((2, 32000)), np.zeros((50, 112, 112))),
        (np.full(32000, np.nan), np.zeros((50, 112, 112))),
        (np.zeros(32000), np.zeros((50, 88, 88))),
        (np.zeros(32000), np.zeros((49, 112, 112))),
        (np.zeros(32000), np.full((50, 112, 112), np.inf)),
    ],
)
def test_av_rejects_invalid_audio_and_visual_input(audio, frames):
    separator = av_api().AvMossFormerSeparator(IdentityModel(), "cpu")
    with pytest.raises(ValueError):
        separator.extract(audio, frames)


def test_av_audio_normalization_restores_input_gain_and_silence():
    separator = av_api().AvMossFormerSeparator(IdentityModel(), "cpu")
    audio = np.full(32000, 0.2, np.float32)
    output = separator.extract(audio, np.zeros((50, 112, 112), np.float32))
    np.testing.assert_array_equal(output, audio)
    assert output.dtype == np.float32
    np.testing.assert_array_equal(
        separator.extract(np.zeros_like(audio), np.zeros((50, 112, 112))), 0
    )


@pytest.mark.parametrize("bad", ["length", "finite"])
def test_av_rejects_malformed_network_output(bad):
    class Broken(torch.nn.Module):
        def forward(self, audio, visual):
            return audio[:, :-1] if bad == "length" else audio * float("nan")

    separator = av_api().AvMossFormerSeparator(Broken(), "cpu")
    with pytest.raises(RuntimeError, match="audio"):
        separator.extract(np.ones(32000, np.float32), np.zeros((50, 112, 112)))


def test_clip_extraction_uses_av_preprocessing_and_schedule():
    separator = av_api().AvMossFormerSeparator(IdentityModel(), "cpu")
    media, track = sample_media(3.4)
    result = extract_track(media, track, separator, lambda: False, lambda _: None)
    assert (result.window_duration, result.stride) == (3, 1.8)
    assert len(result.window_seconds) == 2
    np.testing.assert_allclose(result.audio, media.audio, atol=1e-6)


def test_av_setup_rejects_corruption_before_publishing_manifest(tmp_path):
    av_api()
    checkpoint = tmp_path / "corrupt.pt"
    checkpoint.write_bytes(b"not official weights")
    destination = tmp_path / "assets"
    with pytest.raises(ValueError, match="checksum"):
        assets.setup_assets(destination, engine="av-mossformer2", checkpoint=checkpoint)
    assert not (destination / "manifest.json").exists()


def test_av_loading_rejects_wrong_manifest_before_unpickling(tmp_path, monkeypatch):
    av = av_api()
    (tmp_path / "manifest.json").write_text(json.dumps({"engine": "RTFS-Net-4-LRS2", "files": {}}))
    monkeypatch.setattr(
        torch, "load", lambda *_args, **_kwargs: pytest.fail("Unverified checkpoint loaded")
    )
    with pytest.raises(ValueError, match="manifest"):
        av.AvMossFormerSeparator.load(tmp_path, "cpu")


@pytest.mark.model
def test_official_opt_in_av_engine_smoke():
    if os.environ.get("SPEAKER_AV_MODEL_TESTS") != "1":
        pytest.skip("Explicit official AV-MossFormer2 checkpoint smoke check")
    separator = model.load_separator(Path("data/av-assets"), "auto", "av-mossformer2")
    media, track = sample_media(3)
    frames = faces.prepare_frames(media, track, 0, 3, "av-mossformer2")
    actual = separator.extract(media.audio, frames)
    assert actual.shape == media.audio.shape and actual.dtype == np.float32
    assert np.isfinite(actual).all()
    assert not np.array_equal(actual, media.audio)
    assert separator.parameter_count == 68516407


def test_av_setup_publishes_only_verified_local_copy(tmp_path, monkeypatch):
    import hashlib

    body = b"verified local fixture"
    expected = {"last_best_checkpoint.pt": hashlib.sha256(body).hexdigest()}
    monkeypatch.setattr(assets, "AV_ASSET_HASHES", expected)
    source = tmp_path / "downloaded.pt"
    source.write_bytes(body)
    destination = tmp_path / "assets"
    manifest = assets.setup_assets(destination, "av-mossformer2", source)
    assert manifest["engine"] == "AV-MossFormer2-TSE-16K"
    assert manifest["files"] == expected
    assert json.loads((destination / "manifest.json").read_text()) == manifest
    assert (destination / "last_best_checkpoint.pt").read_bytes() == body
    assert not (destination / "last_best_checkpoint.partial").exists()


def test_av_loading_checks_bytes_before_safe_loader(tmp_path, monkeypatch):
    av = av_api()
    (tmp_path / "manifest.json").write_text(
        json.dumps(
            {
                "engine": "AV-MossFormer2-TSE-16K",
                "files": assets.AV_ASSET_HASHES,
                "source_commit": assets.AV_SOURCE_COMMIT,
                "weight_revision": assets.AV_WEIGHT_REVISION,
            }
        )
    )
    (tmp_path / "last_best_checkpoint.pt").write_bytes(b"corrupt")
    monkeypatch.setattr(
        torch, "load", lambda *_args, **_kwargs: pytest.fail("Unverified bytes loaded")
    )
    with pytest.raises(ValueError, match="checksum"):
        av.AvMossFormerSeparator.load(tmp_path, "cpu")


def test_safe_checkpoint_loader_can_map_training_metadata_without_unrestricted_pickle(tmp_path):
    path = tmp_path / "model.pt"
    torch.save({"model": {"weight": torch.ones(2)}, "optimizer": {}}, path)
    checkpoint = assets.load_checkpoint(path, mmap=True)
    assert checkpoint["model"]["weight"].tolist() == [1, 1]


@pytest.mark.parametrize("component", ["audio", "frames"])
def test_av_rejects_float32_overflow_before_execution(component):
    audio, frames = np.zeros(32000), np.zeros((50, 112, 112))
    (audio if component == "audio" else frames).flat[0] = 1e300
    separator = av_api().AvMossFormerSeparator(IdentityModel(), "cpu")
    with pytest.raises(ValueError, match="finite|float32"):
        separator.extract(audio, frames)


@pytest.mark.asyncio
async def test_live_av_uses_112_face_frames_and_discards_changed_generation(tmp_path):
    import asyncio
    import base64
    from time import monotonic

    from test_noise import IdentityNative

    from sightline_speaker.jobs import Store
    from sightline_speaker.live import LiveConfig, LiveSession
    from sightline_speaker.noise import NoiseSuppressor
    from sightline_speaker.stream_processor import StreamProcessor
    from sightline_speaker.stream_profile import CaptureSpan
    from sightline_speaker.stream_protocol import LiveWindow

    owner = Store(
        Settings(data_dir=tmp_path / "sessions", engine="av-mossformer2"),
        start_worker=False,
        load_model=False,
    )
    owner.separator = av_api().AvMossFormerSeparator(IdentityModel(), "cpu")
    session = LiveSession(
        owner,
        LiveConfig.model_validate(
            {
                "type": "configure",
                "protocol_version": 3,
                "sample_rate": 16000,
                "audio": True,
                "source": "replay",
                "sync_verified": True,
                "video_offset_ms": 0,
                "client_time": monotonic(),
            }
        ),
    )
    media, track = sample_media(3)
    try:
        session.generation = 1
        session.processor = StreamProcessor(
            owner.separator,
            session.profile,
            noise_factory=lambda: NoiseSuppressor(native_factory=IdentityNative),
        )
        session.processor.reset(1)
        session.pending = 1
        session.infer(
            LiveWindow(
                0,
                media.audio,
                media.frames,
                media.timestamps,
                [CaptureSpan(0, 48000, monotonic())],
                48000,
            ),
            track,
            1,
        )
        await asyncio.sleep(0)
        result = session.replies.get_nowait()
        assert result["type"] == "audio"
        assert (result["start_sample"], result["sample_rate"]) == (0, 16000)
        output = np.frombuffer(base64.b64decode(result["pcm"]), dtype="<f4")
        assert len(output) == 28800 - 20
        np.testing.assert_allclose(output[240:], 0.2, atol=1e-6)
        session.generation = 2
        session.pending = 1
        session.infer(None, None, 1)
        await asyncio.sleep(0)
        assert session.replies.empty()
    finally:
        await session.close()
        owner.close()
