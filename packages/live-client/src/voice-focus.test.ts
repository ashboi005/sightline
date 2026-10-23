import { expect, test } from "bun:test";
import type {
  SpeakerServiceCommand,
  SpeakerServiceMessage,
} from "@sightline/contracts";
import { LookToHearController } from "./look-to-hear-controller";

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
  warm_timings: [],
};
const face = (id: string, x: number, timestamp = 0) => ({
  id,
  manual: false,
  observations: [
    { timestamp, box: [x, 0.2, 0.2, 0.3] as [number, number, number, number] },
  ],
});
const gaze = (x = 0.2) => ({
  x,
  y: 0.3,
  valid: true,
  confidence: 0.9,
  ts: 1000,
});
const audio: SpeakerServiceMessage = {
  type: "audio",
  generation: 1,
  start_sample: 0,
  sample_count: 1,
  sample_rate: 16000,
  capture_spans: [],
  device: "cpu",
  timings: {},
  queued_windows: 0,
  pcm: Buffer.from(new Float32Array([0.3]).buffer).toString("base64"),
};
function setup() {
  const sent: SpeakerServiceCommand[] = [];
  const resets: number[] = [];
  const heard: number[] = [];
  let time = 1;
  const controller = new LookToHearController({
    selectionMode: "confirmed",
    clock: () => time,
    send: (command) => sent.push(command),
    sendBinary: () => {},
    onAudio: (_, __, generation) => heard.push(generation),
    onResetAudio: (generation) => resets.push(generation),
  });
  controller.onSpeakerMessage(ready);
  controller.onSpeakerMessage({
    type: "faces",
    generation: 0,
    tracks: [face("A", 0.1), face("B", 0.7)],
  });
  return {
    controller,
    sent,
    resets,
    heard,
    advance: (seconds: number) => (time += seconds),
  };
}

test("AV context and focused-audio readiness follow the current selection", () => {
  const { controller: c } = setup();
  c.onSpeakerMessage({ ...ready, engine: "av-mossformer2", analysis_mode: "windowed", minimum_samples: 48000 });
  expect(c.state.engine).toBe("av-mossformer2");
  expect(c.state.analysisSeconds).toBe(3);
  c.onSpeakerMessage({ type: "faces", generation: 0, tracks: [face("A", 0.1), face("B", 0.7)] });
  c.selectTarget("A");
  expect(c.state.hasAudio).toBe(false);
  c.onSpeakerMessage(audio);
  expect(c.state.hasAudio).toBe(true);
  c.selectTarget("B");
  expect(c.state.hasAudio).toBe(false);
  c.onSpeakerMessage(audio);
  expect(c.state.hasAudio).toBe(false);
  c.onSpeakerMessage({ ...audio, generation: 2 });
  expect(c.state.hasAudio).toBe(true);
  c.onDisconnected();
  expect(c.state.hasAudio).toBe(false);
  expect(c.state.engine).toBeNull();
});

test("voice confirmation selects the calibrated gaze hit and keeps that target when gaze moves", () => {
  const { controller: c, sent } = setup();
  c.onGaze(gaze(), 1000);
  c.onGaze({ ...gaze(), ts: 2000 }, 2000);
  expect(sent).toEqual([]);
  expect(c.selectAtGaze(gaze(), 1000).ok).toBe(true);
  expect(sent).toEqual([{ type: "target", generation: 1, target_id: "A" }]);
  c.onGaze({ ...gaze(0.8), ts: 2100 }, 2100);
  c.onGaze({ ...gaze(0.8), ts: 3100 }, 3100);
  expect(c.state.targetId).toBe("A");
  expect(sent).toHaveLength(1);
  expect(c.selectAtGaze(gaze(0.8), NaN).ok).toBe(false);
});

test("invalid, stale, future and off-face gaze never replace a locked speaker", () => {
  const { controller: c, sent } = setup();
  c.selectAtGaze(gaze(), 1000);
  for (const sample of [
    { ...gaze(0.8), valid: false },
    { ...gaze(0.8), confidence: 0.1 },
    { ...gaze(0.8), ts: 499 },
    { ...gaze(0.8), ts: 1100 },
    { ...gaze(), x: NaN },
    gaze(0.5),
  ])
    expect(c.selectAtGaze(sample, 1000).ok).toBe(false);
  expect(c.state.targetId).toBe("A");
  expect(sent).toHaveLength(1);
});

test("ambiguous and expired face observations cannot be selected", () => {
  const { controller: c, advance } = setup();
  c.onSpeakerMessage({
    type: "faces",
    generation: 0,
    tracks: [face("A", 0.1), face("B", 0.1)],
  });
  expect(c.selectAtGaze(gaze(), 1000).ok).toBe(false);
  c.onSpeakerMessage({
    type: "faces",
    generation: 0,
    tracks: [face("A", 0.1)],
  });
  advance(1.1);
  expect(c.selectAtGaze(gaze(), 1000).ok).toBe(false);
  expect(c.selectTarget("A").ok).toBe(false);
});

test("losing the locked face clears queued audio and never adopts a newcomer", () => {
  const { controller: c, heard, resets } = setup();
  c.selectAtGaze(gaze(), 1000);
  c.onSpeakerMessage(audio);
  expect(heard).toEqual([1]);
  c.onSpeakerMessage({
    type: "faces",
    generation: 1,
    tracks: [face("newcomer", 0.1)],
  });
  expect(c.state.status).toBe("TARGET_LOST");
  expect(c.state.targetId).toBeNull();
  expect(resets.at(-1)).toBe(c.state.generation);
  c.onSpeakerMessage(audio);
  c.onSpeakerMessage({
    type: "flow",
    generation: 1,
    action: "resume",
    reason: "ready",
    queued_windows: 0,
  });
  expect(heard).toEqual([1]);
  expect(c.state.status).toBe("TARGET_LOST");
});

test("a frozen network source mutes focus even when no service messages arrive", () => {
  const { controller: c, advance, resets } = setup();
  c.selectAtGaze(gaze(), 1000);
  advance(1.1);
  c.checkFreshness();
  expect(c.state.status).toBe("TARGET_LOST");
  expect(c.state.targetId).toBeNull();
  expect(resets.at(-1)).toBe(c.state.generation);
});

test("reconnecting discards the target and requires a new selection in the new service session", () => {
  const { controller: c, heard } = setup();
  c.selectAtGaze(gaze(), 1000);
  c.onDisconnected();
  c.onSpeakerMessage(audio);
  expect(heard).toEqual([]);
  expect(c.state.status).toBe("CONNECTING");
  c.onSpeakerMessage(ready);
  expect(c.state.generation).toBe(0);
  expect(c.state.targetId).toBeNull();
  expect(c.state.faces).toEqual([]);
});

test("frame alignment includes microphone samples waiting for the next 200 ms packet", () => {
  const { controller: c } = setup();
  c.pushMic(new Float32Array(5000));
  expect(c.sourceSample).toBe(5000);
});

test("audio capture metadata dates the first sample rather than the packet send time", () => {
  const packets: ArrayBuffer[] = [];
  const controller = new LookToHearController({
    clock: () => 10,
    send: () => {},
    sendBinary: (packet) => packets.push(packet),
    onAudio: () => {},
  });
  controller.onSpeakerMessage(ready);
  controller.onSpeakerMessage({ type: "faces", generation: 0, tracks: [face("A", 0.1)] });
  controller.selectTarget("A");
  controller.pushMic(new Float32Array(8000));
  const headers = packets.map((packet) => new DataView(packet));
  expect(headers).toHaveLength(2);
  expect(headers[0]!.getFloat64(20, true)).toBeCloseTo(9.5);
  expect(headers[1]!.getFloat64(20, true)).toBeCloseTo(9.7);
});

test("inference timing uses the reported total once", () => {
  const { controller } = setup();
  controller.selectTarget("A");
  controller.onSpeakerMessage({
    ...audio,
    timings: {
      preparation_seconds: 0.1,
      extraction_seconds: 0.4,
      overlap_seconds: 0.02,
      enhancement_seconds: 0.03,
      processing_seconds: 0.55,
    },
  });
  expect(controller.state.lastInferenceSeconds).toBe(0.55);
});

test("an overloaded session can still clear its selected speaker immediately", () => {
  const { controller: c } = setup();
  c.selectAtGaze(gaze(), 1000);
  c.onSpeakerMessage({
    type: "flow",
    generation: 1,
    action: "pause",
    reason: "overloaded",
    queued_windows: 1,
  });
  expect(c.selectTarget(null).ok).toBe(true);
  expect(c.state.targetId).toBeNull();
});

test("selecting a speaker excludes room audio captured before confirmation", () => {
  const sent: ArrayBuffer[] = [];
  const c = new LookToHearController({
    send: () => {},
    sendBinary: (packet) => sent.push(packet),
    onAudio: () => {},
  });
  c.onSpeakerMessage(ready);
  c.onSpeakerMessage({
    type: "faces",
    generation: 0,
    tracks: [face("A", 0.1)],
  });
  c.pushMic(new Float32Array(1600));
  c.selectTarget("A");
  c.pushMic(new Float32Array(3200));
  expect(Number(new DataView(sent[0]!).getBigUint64(12, true))).toBe(1600);
});

test("an output failure cannot be undone by a late target acknowledgement or audio", () => {
  const { controller: c, heard } = setup();
  c.selectTarget("A");
  c.fail("Requested speaker rejected");
  c.onSpeakerMessage({ type: "selected", generation: 1, target_id: "A" });
  c.onSpeakerMessage(audio);
  c.onSpeakerMessage(ready);
  expect(c.state.status).toBe("ERROR");
  expect(c.state.targetId).toBeNull();
  expect(heard).toEqual([]);
});
