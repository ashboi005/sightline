"""Actual timestamp-paced available-input replay. Latency is measured, never a pass threshold."""

import argparse
import asyncio
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
from time import monotonic

import cv2
import numpy as np
import psutil
import soundfile as sf
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from .assets import ASSET_HASHES, AV_ASSET_HASHES, sha256_file
from .media import decode_media, run_media_command
from .stream_protocol import encode_packet


class OutputLedger:
    def __init__(self, generation, start=0):
        self.generation = generation
        self.start = start
        self.accepted_end = start
        self.output_end = start
        self.outputs = []
        self.pcm = []
        self.rejected_old_outputs = 0

    @property
    def accepted_sample_count(self):
        return self.accepted_end - self.start

    @property
    def output_sample_count(self):
        return self.output_end - self.start

    def accept(self, start, count):
        if start != self.accepted_end or count <= 0:
            raise ValueError("Input source discontinuity")
        self.accepted_end = start + count

    def audio(self, reply, received):
        if reply["generation"] != self.generation:
            self.rejected_old_outputs += 1
            return None
        start = reply["start_sample"]
        count = reply["sample_count"]
        pcm = np.frombuffer(base64.b64decode(reply["pcm"], validate=True), dtype="<f4").copy()
        if start != self.output_end or pcm.size != count or not np.isfinite(pcm).all():
            raise ValueError("Output source discontinuity or invalid PCM")
        if start + count > self.accepted_end:
            raise ValueError("Output includes unaccepted future audio")
        cursor = start
        for span in reply["capture_spans"]:
            if span["start_sample"] != cursor or span["end_sample"] <= cursor:
                raise ValueError("Capture map discontinuity")
            cursor = span["end_sample"]
        if cursor != start + count:
            raise ValueError("Incomplete capture map")
        self.output_end += count
        self.pcm.append(pcm)
        record = {key: value for key, value in reply.items() if key != "pcm"}
        record["received_clock_seconds"] = received
        record["arrival_delay_seconds"] = received - reply["capture_spans"][0]["capture_time"]
        record["pcm_sha256"] = hashlib.sha256(pcm.tobytes()).hexdigest()
        self.outputs.append(record)
        return pcm

    def drained(self, end):
        return self.output_end == self.accepted_end == end


def provenance(source, pcm):
    spec = importlib.util.find_spec("pyrnnoise")
    native = Path(spec.origin).parent / "librnnoise.dylib" if spec and spec.origin else None
    return {
        "input_sha256": sha256_file(source),
        "mixed_pcm_sha256": hashlib.sha256(pcm.astype("<f4").tobytes()).hexdigest(),
        "kind": "timestamp-paced original mixed PCM and only elapsed source video",
        "native_package": "pyrnnoise-0.4.5",
        "native_library_sha256": sha256_file(native) if native and native.exists() else None,
        "ground_truth_inference_access": False,
        "physical_esp32_validation": False,
    }


async def replay(
    source: Path, output: Path, origin: str, speaker="left", pid=None, region=True, gaze=None
):
    media = decode_media(source)
    output.mkdir(parents=True, exist_ok=True)
    report = provenance(source, media.audio)
    report.update(
        {
            "speaker": speaker,
            "input_sample_count": media.audio.size,
            "flow_events": [],
            "errors": [],
            "manual_region": region,
        }
    )
    points = {"left": (0.22, 0.35), "middle": (0.49, 0.35), "right": (0.79, 0.35)}
    regions = {
        "left": (0, 0.05, 0.35, 0.65),
        "middle": (0.40, 0.10, 0.20, 0.55),
        "right": (0.65, 0.05, 0.35, 0.65),
    }
    report["correction_region"] = regions[speaker] if region else None
    generation = 0
    ledger = None
    selected = asyncio.Event()
    done = asyncio.Event()
    fault = asyncio.Event()
    peak = 0
    begin = monotonic()
    async with connect("ws://127.0.0.1:7799/live", origin=origin, max_size=1024 * 1024) as socket:
        await socket.send(
            json.dumps(
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
            )
        )
        ready = json.loads(await socket.recv())
        if ready.get("type") != "ready":
            raise RuntimeError(ready)
        report["ready"] = ready
        report["model_hashes"] = (
            AV_ASSET_HASHES if ready["engine"] == "av-mossformer2" else ASSET_HASHES
        )
        if region:
            await socket.send(json.dumps({"type": "region", "box": regions[speaker]}))
            corrected = json.loads(await socket.recv())
            if corrected.get("message") != "Region changed; select the corrected face":
                raise RuntimeError(corrected)
            generation = corrected["generation"]
        begin = monotonic()

        async def receive():
            nonlocal generation, ledger, peak
            async for message in socket:
                reply = json.loads(message)
                if pid:
                    peak = max(peak, psutil.Process(pid).memory_info().rss)
                if (
                    reply["type"] == "faces"
                    and not selected.is_set()
                    and reply["generation"] == generation
                ):
                    # The simulated gaze point: the face containing it becomes the target.
                    x, y = gaze or points[speaker]
                    matches = [
                        t
                        for t in reply["tracks"]
                        if t["observations"][0]["box"][0]
                        <= x
                        <= sum(t["observations"][0]["box"][::2])
                        and t["observations"][0]["box"][1]
                        <= y
                        <= sum(t["observations"][0]["box"][1::2])
                    ]
                    if len(matches) == 1:
                        generation += 1
                        ledger = OutputLedger(generation)
                        await socket.send(
                            json.dumps(
                                {
                                    "type": "target",
                                    "generation": generation,
                                    "target_id": matches[0]["id"],
                                }
                            )
                        )
                        selected.set()
                elif reply["type"] == "flow" and reply["generation"] == generation:
                    report["flow_events"].append({**reply, "elapsed_seconds": monotonic() - begin})
                    if reply["action"] == "pause":
                        report["errors"].append(
                            {"code": "capture_overload", "message": reply["reason"]}
                        )
                        fault.set()
                        done.set()
                elif reply["type"] == "audio" and ledger:
                    ledger.audio(reply, monotonic())
                elif reply["type"] == "drained" and ledger and reply["generation"] == generation:
                    report["drain_conserved"] = ledger.drained(reply["source_end_sample"])
                    done.set()
                elif reply["type"] == "error":
                    report["errors"].append(reply)
                    fault.set()
                    done.set()

        async def heartbeat():
            while not done.is_set():
                await asyncio.sleep(2)
                await socket.send(json.dumps({"type": "heartbeat"}))

        receiver = asyncio.create_task(receive())
        heartbeats = asyncio.create_task(heartbeat())
        try:
            # Discovery at source time zero; no future face observations or target stems.
            def jpeg(index):
                success, encoded = cv2.imencode(
                    ".jpg",
                    cv2.cvtColor(media.frames[index], cv2.COLOR_RGB2BGR),
                    [cv2.IMWRITE_JPEG_QUALITY, 70],
                )
                if not success:
                    raise ValueError("JPEG encoding failed")
                return encoded.tobytes()

            await socket.send(encode_packet(2, generation, 0, monotonic(), jpeg(0)))
            await asyncio.wait_for(selected.wait(), 10)
            # Target control resets input; resend the currently presented first frame.
            await socket.send(encode_packet(2, generation, 0, monotonic(), jpeg(0)))
            begin = monotonic()
            events = [
                (min(media.audio.size, start + 1600) / 16000, 1, start)
                for start in range(0, media.audio.size, 1600)
            ]
            events += [(float(t), 2, index) for index, t in enumerate(media.timestamps) if index]
            events.sort(key=lambda item: (item[0], -item[1]))
            for timestamp, kind, index in events:
                while not fault.is_set():
                    remaining = begin + timestamp - monotonic()
                    if remaining <= 0:
                        break
                    await asyncio.sleep(min(0.05, remaining))
                if fault.is_set():
                    break
                if receiver.done():
                    await receiver
                if kind == 1:
                    pcm = media.audio[index : index + 1600].astype("<f4")
                    ledger.accept(index, pcm.size)
                    payload = pcm.tobytes()
                    sample = index
                    capture = begin + sample / 16000
                else:
                    payload = jpeg(index)
                    sample = round(timestamp * 16000)
                    capture = begin + timestamp
                await socket.send(encode_packet(kind, generation, sample, capture, payload))
            if not fault.is_set():
                await socket.send(
                    json.dumps({"type": "end", "source_end_sample": ledger.accepted_end})
                )
                await asyncio.wait_for(done.wait(), 90)
            await socket.send(json.dumps({"type": "stop"}))
            await receiver
        except (ConnectionClosed, TimeoutError, ValueError, RuntimeError) as exc:
            report["errors"].append({"code": "benchmark_interrupted", "message": str(exc)})
        finally:
            heartbeats.cancel()
            receiver.cancel()
            await asyncio.gather(heartbeats, receiver, return_exceptions=True)
    timings = (
        [item["timings"].get("processing_seconds", 0) for item in ledger.outputs] if ledger else []
    )
    delays = [item["arrival_delay_seconds"] for item in ledger.outputs] if ledger else []
    report.update(
        {
            "elapsed_seconds": monotonic() - begin,
            "source_pause_seconds": 0,
            "peak_server_rss_bytes": peak if pid is not None else None,
            "outputs": ledger.outputs if ledger else [],
            "accepted_sample_count": ledger.accepted_sample_count if ledger else 0,
            "output_sample_count": ledger.output_sample_count if ledger else 0,
            "rejected_old_outputs": ledger.rejected_old_outputs if ledger else 0,
            "processing_median_seconds": float(np.median(timings)) if timings else None,
            "processing_p95_seconds": float(np.percentile(timings, 95)) if timings else None,
            "arrival_delay_p95_seconds": float(np.percentile(delays, 95)) if delays else None,
        }
    )
    report["complete"] = bool(
        report.get("drain_conserved")
        and not report["errors"]
        and report["output_sample_count"] == media.audio.size
    )
    focused = np.zeros(media.audio.size, np.float32)
    if ledger:
        cursor = ledger.start
        for pcm in ledger.pcm:
            focused[cursor : cursor + pcm.size] = pcm
            cursor += pcm.size
    wav = output / "focused.wav"
    sf.write(wav, focused, 16000, subtype="FLOAT")
    sf.write(output / "original-mixed.wav", media.audio, 16000, subtype="FLOAT")
    run_media_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(source.resolve()),
            "-i",
            str(wav.resolve()),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            str((output / "focused-preview.mp4").resolve()),
        ]
    )
    report["focused_sha256"] = sha256_file(wav)
    (output / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "outputs"}, indent=2), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--origin", default="http://127.0.0.1:4010")
    parser.add_argument("--speaker", choices=["left", "middle", "right"], default="left")
    parser.add_argument("--server-pid", type=int)
    parser.add_argument("--automatic-faces", action="store_true")
    parser.add_argument(
        "--gaze",
        type=lambda v: tuple(float(n) for n in v.split(",")),
        help="normalised x,y gaze point selecting the target face (overrides the --speaker point)",
    )
    args = parser.parse_args()
    report = asyncio.run(
        replay(
            args.input,
            args.output,
            args.origin,
            args.speaker,
            args.server_pid,
            not args.automatic_faces,
            args.gaze,
        )
    )
    if not report["complete"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
