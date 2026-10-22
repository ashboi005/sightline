import asyncio
import base64
from types import SimpleNamespace

import numpy as np
import pytest

from sightline_speaker.streaming_reference import OutputLedger, provenance, replay


def audio(generation, start, size, delay=12):
    pcm = np.full(size, 0.2, dtype="<f4")
    return {
        "type": "audio",
        "generation": generation,
        "start_sample": start,
        "sample_count": size,
        "sample_rate": 16000,
        "device": "cpu",
        "capture_spans": [
            {"start_sample": start, "end_sample": start + size, "capture_time": delay}
        ],
        "timings": {"processing_seconds": 10},
        "queued_windows": 2,
        "pcm": base64.b64encode(pcm.tobytes()).decode(),
    }


def test_ledger_conserves_partial_final_samples_without_latency_pass_threshold():
    ledger = OutputLedger(3, 917)
    ledger.accept(917, 16000)
    ledger.accept(16917, 17)
    assert ledger.audio(audio(2, 917, 16000), 100) is None
    assert ledger.rejected_old_outputs == 1
    ledger.audio(audio(3, 917, 10001), 100)
    ledger.audio(audio(3, 10918, 6016), 150)
    assert ledger.drained(16934)
    assert ledger.output_sample_count == ledger.accepted_sample_count == 16017
    assert max(r["arrival_delay_seconds"] for r in ledger.outputs) > 4
    with pytest.raises(ValueError):
        ledger.audio(audio(3, 917, 17), 160)


def test_report_keeps_exact_input_and_native_provenance(tmp_path):
    source = tmp_path / "mixed.mp4"
    source.write_bytes(b"one mixed input")
    report = provenance(source, np.zeros(17, np.float32))
    assert len(report["input_sha256"]) == 64
    assert len(report["mixed_pcm_sha256"]) == 64
    assert report["native_package"] == "pyrnnoise-0.4.5"
    assert report["ground_truth_inference_access"] is False
    assert "playout_seconds" not in report


@pytest.mark.asyncio
async def test_paced_report_preserves_server_failure_and_marks_partial_audio(tmp_path, monkeypatch):
    import json

    import sightline_speaker.streaming_reference as benchmark

    class FailedSocket:
        def __init__(self):
            self.messages = asyncio.Queue()
            self.closed = False
            self.frames = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def recv(self):
            return json.dumps({"type": "ready", "engine": "av-mossformer2"})

        async def send(self, data):
            if self.closed:
                raise RuntimeError("socket closed by service")
            if isinstance(data, bytes):
                self.frames += 1
                if self.frames == 1:
                    await self.messages.put(
                        json.dumps(
                            {
                                "type": "faces",
                                "generation": 0,
                                "tracks": [
                                    {
                                        "id": "face",
                                        "observations": [{"timestamp": 0, "box": [0, 0, 1, 1]}],
                                    }
                                ],
                            }
                        )
                    )
                else:
                    await self.messages.put(
                        json.dumps(
                            {
                                "type": "error",
                                "generation": 1,
                                "code": "invalid_live_input",
                                "message": "real input failure",
                            }
                        )
                    )
                    self.closed = True

        def __aiter__(self):
            return self

        async def __anext__(self):
            return await self.messages.get()

    source = tmp_path / "input.mp4"
    source.write_bytes(b"original")
    monkeypatch.setattr(benchmark, "connect", lambda *_, **__: FailedSocket())
    monkeypatch.setattr(
        benchmark,
        "decode_media",
        lambda _: SimpleNamespace(
            audio=np.zeros(17, np.float32),
            frames=[np.zeros((8, 8, 3), np.uint8)],
            timestamps=[0],
        ),
    )
    monkeypatch.setattr(benchmark, "run_media_command", lambda _: None)
    report = await replay(source, tmp_path / "result", "http://127.0.0.1:4010", region=False)
    assert not report["complete"]
    assert any(error["message"] == "real input failure" for error in report["errors"])
    assert (tmp_path / "result" / "report.json").exists()
    assert report["output_sample_count"] == 0


def test_cli_rejects_an_incomplete_benchmark_instead_of_reporting_success(monkeypatch):
    import sightline_speaker.streaming_reference as benchmark

    async def incomplete(*_):
        return {"complete": False}

    monkeypatch.setattr(benchmark, "replay", incomplete)
    monkeypatch.setattr("sys.argv", ["benchmark", "--input", "input.mp4", "--output", "output"])
    with pytest.raises(SystemExit) as error:
        benchmark.main()
    assert error.value.code == 1
