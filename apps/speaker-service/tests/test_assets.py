import importlib
import zipfile

import pytest


def asset_api():
    try:
        return importlib.import_module("sightline_speaker.assets")
    except ModuleNotFoundError:
        pytest.fail("verified asset handling is not implemented")


def test_rejects_archive_that_escapes_destination(tmp_path):
    archive = tmp_path / "malicious.zip"
    with zipfile.ZipFile(archive, "w") as contents:
        contents.writestr("../escape.pth", b"untrusted")
    with pytest.raises(ValueError, match="path"):
        asset_api().safe_extract(archive, tmp_path / "assets")
    assert not (tmp_path / "escape.pth").exists()


def test_rejects_corrupted_checkpoint_hash(tmp_path):
    checkpoint = tmp_path / "weights.pth"
    checkpoint.write_bytes(b"wrong checkpoint")
    with pytest.raises(ValueError, match="checksum"):
        asset_api().verify_file(checkpoint, "0" * 64)


def test_extracts_regular_files(tmp_path):
    archive = tmp_path / "regular.zip"
    with zipfile.ZipFile(archive, "w") as contents:
        contents.writestr("4_layer/weights.pth", b"tensor data")
    asset_api().safe_extract(archive, tmp_path / "assets")
    assert (tmp_path / "assets/4_layer/weights.pth").read_bytes() == b"tensor data"


def test_loads_legacy_torch_version_metadata_safely(tmp_path):
    import torch

    checkpoint = tmp_path / "legacy.pth"
    torch.save(
        {"version": torch.torch_version.TorchVersion("2.0.0"), "weight": torch.ones(2)}, checkpoint
    )
    result = asset_api().load_checkpoint(checkpoint)
    assert str(result["version"]) == "2.0.0"
    assert result["weight"].tolist() == [1.0, 1.0]


def test_does_not_fall_back_to_unrestricted_pickle(tmp_path):
    import pickle

    import torch

    checkpoint = tmp_path / "unsupported.pth"
    torch.save({"callable": eval}, checkpoint)
    with pytest.raises(pickle.UnpicklingError):
        asset_api().load_checkpoint(checkpoint)


def test_download_checks_hash_before_publishing(tmp_path):
    import httpx

    destination = tmp_path / "checkpoint.pth"
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"corrupt"))
    )
    with pytest.raises(ValueError, match="checksum"):
        asset_api().download_file(
            "https://example.test/checkpoint", destination, "0" * 64, client=client
        )
    assert not destination.exists()
    assert not destination.with_suffix(".partial").exists()


def test_download_publishes_verified_bytes(tmp_path):
    import hashlib

    import httpx

    destination = tmp_path / "checkpoint.pth"
    body = b"verified tensor bytes"
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=body))
    )
    asset_api().download_file(
        "https://example.test/checkpoint",
        destination,
        hashlib.sha256(body).hexdigest(),
        client=client,
    )
    assert destination.read_bytes() == body
