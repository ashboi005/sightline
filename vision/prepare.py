"""Explicit, checksum-verified download of the pinned official model assets."""

import hashlib
import json
import ssl
import urllib.request
from pathlib import Path

import certifi

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / ".local-reference" / "vision-models"


def verify(path: Path, digest: str) -> bool:
    if not path.is_file():
        return False
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest() == digest


def prepare():
    MODELS.mkdir(parents=True, exist_ok=True)
    for asset in json.loads(Path(__file__).with_name("assets.json").read_text()):
        destination = MODELS / asset["name"]
        if verify(destination, asset["sha256"]):
            continue
        temporary = destination.with_suffix(".download")
        request = urllib.request.Request(
            asset["url"] + "?download=1", headers={"User-Agent": "GazeCore-model-setup"}
        )
        try:
            with (
                urllib.request.urlopen(
                    request, timeout=60, context=ssl.create_default_context(cafile=certifi.where())
                ) as response,
                temporary.open("wb") as output,
            ):
                while block := response.read(1024 * 1024):
                    output.write(block)
            if not verify(temporary, asset["sha256"]):
                raise RuntimeError(f"Checksum mismatch for {asset['name']}")
            temporary.replace(destination)
            print(f"Prepared {asset['name']}")
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    prepare()
