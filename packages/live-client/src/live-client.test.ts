import { describe, expect, it } from "bun:test";
import type { SpeakerServiceCommand, SpeakerServiceMessage } from "@sightline/contracts";

import { LookToHearController } from "./look-to-hear-controller";
import { Chunker, floatToLinear16, StreamingResampler } from "./pcm";
import { PlaybackScheduler } from "./playback-scheduler";

describe("StreamingResampler", () => {
  it("48 kHz → 16 kHz yields exactly a third of the samples across arbitrary chunk boundaries", () => {
    const r = new StreamingResampler(48000);
    let out = 0;
    for (const size of [128, 128, 1000, 7, 3537]) out += r.process(new Float32Array(size).fill(0.5)).length;
    expect(out).toBe(Math.floor((128 + 128 + 1000 + 7 + 3537) / 3));
  });

  it("44.1 kHz keeps the right rate and preserves DC level", () => {
    const r = new StreamingResampler(44100);
    const out = r.process(new Float32Array(44100).fill(0.25));
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(1);
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });

  it("attenuates content above the new Nyquist (box filter)", () => {
    const r = new StreamingResampler(48000);
    const tone = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 16000 * i) / 48000));
    const out = r.process(tone);
    const peak = Math.max(...out.map(Math.abs));
    expect(peak).toBeLessThan(0.05);
  });
});

describe("floatToLinear16 / Chunker", () => {
  it("encodes little-endian int16 with clamping", () => {
    const bytes = floatToLinear16(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(bytes.buffer);
    expect([0, 1, 2, 3].map((i) => view.getInt16(i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it("re-chunks a stream into fixed sizes and flushes the tail", () => {
    const c = new Chunker(4);
    expect(c.push(new Float32Array([1, 2, 3])).length).toBe(0);
    const chunks = c.push(new Float32Array([4, 5, 6, 7, 8, 9]));
    expect(chunks.map((x) => [...x])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect([...c.flush()!]).toEqual([9]);
  });
});

describe("PlaybackScheduler", () => {
  it("keeps source spacing, grows the delay on underrun, and drops older generations", () => {
    const s = new PlaybackScheduler({ initialDelay: 0.4, underrunPadding: 0.1 });
    const a = s.schedule(1, 0, 3200, 10)!;
    expect(a.when).toBeCloseTo(10.4);
    expect(s.schedule(1, 3200, 3200, 10.1)!.when).toBeCloseTo(10.6);
    // A chunk arriving late (would play in the past) slides the timeline instead of being skipped.
    const late = s.schedule(1, 6400, 3200, 11)!;
    expect(late.when).toBeGreaterThanOrEqual(11.02);
    expect(s.delay).toBeGreaterThan(0.4);
    // New target: starts after what is already queued; old generation is dropped.
    const next = s.schedule(2, 50_000, 3200, 11.05)!;
    expect(next.when).toBeGreaterThanOrEqual(late.when + 0.2);
    expect(s.schedule(1, 9600, 3200, 11.1)).toBeNull();
  });
});

describe("LookToHearController", () => {
  const setup = () => {
    const sent: SpeakerServiceCommand[] = [];
    const binary: ArrayBuffer[] = [];
    const audio: { start: number; generation: number; length: number }[] = [];
    let t = 100;
    const c = new LookToHearController({
      send: (cmd) => sent.push(cmd),
      sendBinary: (p) => binary.push(p),
      onAudio: (pcm, start, generation) => audio.push({ start, generation, length: pcm.length }),
      clock: () => t,
      selector: { dwellMs: 300 },
    });
    const header = (p: ArrayBuffer) => {
      const v = new DataView(p);
      return { kind: v.getUint8(4), generation: v.getUint32(8, true), sample: Number(v.getBigUint64(12, true)) };
    };
    return { c, sent, binary, audio, header, advance: (dt: number) => (t += dt) };
  };
  const ready: SpeakerServiceMessage = {
    type: "ready",
    generation: 0,
    device: "cpu",
    protocol_version: 3,
    analysis_mode: "available",
    engine: "rtfs",
    minimum_samples: 1920,
    history_samples: 6400,
    maximum_input_samples: 128000,
    noise_processor: "off",
    warm_timings: [0.2],
  };
  const faces: SpeakerServiceMessage = {
    type: "faces",
    generation: 0,
    tracks: [
      { id: "L", manual: false, observations: [{ timestamp: 0, box: [0.1, 0.4, 0.2, 0.4] }] },
      { id: "R", manual: false, observations: [{ timestamp: 0, box: [0.7, 0.4, 0.2, 0.4] }] },
    ],
  };
  const gaze = (x: number, y: number, ts: number) => ({ x, y, valid: true, confidence: 0.9, ts });

  it("selects the looked-at face after the dwell and streams audio only while listening", async () => {
    const { c, sent, binary, header } = setup();
    c.onSpeakerMessage(ready);
    c.onSpeakerMessage(faces);
    c.pushFrame(new Uint8Array([1]));
    c.pushMic(new Float32Array(3200)); // before a target: nothing sent
    expect(binary.map(header).map((h) => h.kind)).toEqual([2]);

    c.onGaze(gaze(0.2, 0.6, 1000), 1000);
    c.onGaze(gaze(0.2, 0.6, 1200), 1200);
    expect(sent).toEqual([]);
    c.onGaze(gaze(0.2, 0.6, 1350), 1350);
    expect(sent).toEqual([{ type: "target", generation: 1, target_id: "L" }]);
    expect(c.state.status).toBe("LISTENING");

    c.pushMic(new Float32Array(5000));
    const pcm = binary.map(header).filter((h) => h.kind === 1);
    expect(pcm).toEqual([{ kind: 1, generation: 1, sample: 3200 }]); // 1800 samples wait in the chunker
    c.pushFrame(new Uint8Array([2]));
    expect(header(binary.at(-1)!)).toEqual({ kind: 2, generation: 1, sample: 6400 });

    const stopping = c.stop();
    expect(sent.at(-1)).toEqual({ type: "end", source_end_sample: 6400 });
    c.onSpeakerMessage({ type: "drained", generation: 1, source_end_sample: 6400 });
    await stopping;
    expect(sent.at(-1)).toEqual({ type: "stop" });
  });

  it("drops audio from an old generation and recovers after a lost target", () => {
    const { c, audio } = setup();
    c.onSpeakerMessage(ready);
    c.onSpeakerMessage(faces);
    c.selectTarget("R");
    const audioMsg = (generation: number): SpeakerServiceMessage => ({
      type: "audio",
      generation,
      start_sample: 0,
      sample_count: 2,
      sample_rate: 16000,
      capture_spans: [],
      device: "cpu",
      timings: { preparation_seconds: 0.1, extraction_seconds: 0.4 },
      queued_windows: 0,
      pcm: Buffer.from(new Float32Array([0.1, 0.2]).buffer).toString("base64"),
    });
    c.onSpeakerMessage(audioMsg(0));
    c.onSpeakerMessage(audioMsg(1));
    expect(audio).toEqual([{ start: 0, generation: 1, length: 2 }]);
    expect(c.state.lastInferenceSeconds).toBe(0.5);

    c.onSpeakerMessage({ type: "error", code: "synchronization_or_target_lost", message: "Selected face was lost", generation: 2 });
    expect(c.state.status).toBe("TARGET_LOST");
    expect(c.state.generation).toBe(2);
    c.selectTarget("L");
    expect(c.state.generation).toBe(3);
  });
});
