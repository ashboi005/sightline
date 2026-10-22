import { afterEach, describe, expect, it } from "bun:test";
import type { RawTranscriptSegment } from "@sightline/contracts";
import type { ServerWebSocket } from "bun";

import { buildSarvamUrl, SarvamStt, SPEAKING_PLACEHOLDER } from "./sarvam-stt";
import type { SttStreamOptions } from "./types";

function fakeSarvam() {
  const state = {
    key: null as string | null,
    url: null as URL | null,
    audio: [] as Uint8Array[],
    control: [] as string[],
    socket: null as ServerWebSocket<unknown> | null,
  };
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      state.key = req.headers.get("api-subscription-key");
      state.url = new URL(req.url);
      if (srv.upgrade(req)) return;
      return new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        state.socket = ws;
      },
      message(ws, msg) {
        const parsed = JSON.parse(String(msg));
        if (parsed.audio) {
          expect(parsed.audio).toMatchObject({ sample_rate: "16000", encoding: "audio/wav" });
          state.audio.push(new Uint8Array(Buffer.from(parsed.audio.data, "base64")));
        } else {
          state.control.push(parsed.type);
          if (parsed.type === "flush") {
            ws.send(JSON.stringify({ type: "data", data: { request_id: "r", transcript: "aur yeh last line hai", metrics: { audio_duration: 1, processing_latency: 0.1 } } }));
          }
        }
      },
    },
  });
  const send = (msg: unknown) => state.socket!.send(JSON.stringify(msg));
  return { server, state, send, base: `ws://localhost:${server.port}` };
}

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await Bun.sleep(10);
  }
};

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

const options = (segments: RawTranscriptSegment[]): SttStreamOptions => {
  let seq = 0;
  return {
    sessionId: "ses_hi",
    format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 },
    keyterms: [],
    startedAt: Date.now() - 5000,
    nextSeq: () => seq++,
    onSegment: (s) => segments.push(s),
    onError: () => {},
  };
};

const opts = { apiKey: "sk_sarvam", model: "saaras:v3", mode: "codemix", language: "hi-IN" };

describe("buildSarvamUrl", () => {
  it("requests codemix Hinglish over raw 16 kHz PCM with VAD signals", () => {
    const url = new URL(buildSarvamUrl("wss://api.sarvam.ai", opts, options([])));
    expect(url.pathname).toBe("/speech-to-text/ws");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      "language-code": "hi-IN",
      model: "saaras:v3",
      mode: "codemix",
      sample_rate: "16000",
      input_audio_codec: "pcm_s16le",
      vad_signals: "true",
    });
  });
});

describe("SarvamStt", () => {
  it("authenticates, sends base64 PCM, and maps START_SPEECH → … → final transcript under one id", async () => {
    const fake = fakeSarvam();
    servers.push(fake.server);
    const segments: RawTranscriptSegment[] = [];
    const stream = new SarvamStt({ ...opts, baseUrl: fake.base }).open(options(segments));
    stream.push(new Uint8Array([1, 2, 3, 4])); // buffered until open
    await waitFor(() => fake.state.audio.length === 1);
    expect(fake.state.key).toBe("sk_sarvam");
    expect([...fake.state.audio[0]!]).toEqual([1, 2, 3, 4]);

    fake.send({ type: "events", data: { signal_type: "START_SPEECH", event_type: "x" } });
    fake.send({ type: "data", data: { request_id: "r", transcript: "Kirchhoff ka current law kehta hai ki node पर sum zero hota hai", metrics: { audio_duration: 2.5 } } });
    await waitFor(() => segments.length === 2);
    expect(segments[0]).toMatchObject({ text: SPEAKING_PLACEHOLDER, isFinal: false, seq: 0 });
    expect(segments[1]).toMatchObject({ isFinal: true, seq: 0, id: segments[0]!.id });
    expect(segments[1]!.text).toContain("पर");

    // Transcript without a preceding START_SPEECH still becomes its own segment.
    fake.send({ type: "data", data: { request_id: "r2", transcript: "achha", metrics: { audio_duration: 0.5 } } });
    await waitFor(() => segments.length === 3);
    expect(segments[2]).toMatchObject({ text: "achha", isFinal: true, seq: 1 });

    // Close flushes the last utterance and waits for it.
    fake.send({ type: "events", data: { signal_type: "START_SPEECH" } });
    await waitFor(() => segments.length === 4);
    await stream.close();
    expect(fake.state.control).toContain("flush");
    expect(segments.at(-1)).toMatchObject({ text: "aur yeh last line hai", isFinal: true });
  });

  it("clears the placeholder when Sarvam returns an empty transcript", async () => {
    const fake = fakeSarvam();
    servers.push(fake.server);
    const segments: RawTranscriptSegment[] = [];
    const stream = new SarvamStt({ ...opts, baseUrl: fake.base }).open(options(segments));
    await waitFor(() => fake.state.socket !== null);
    fake.send({ type: "events", data: { signal_type: "START_SPEECH" } });
    fake.send({ type: "data", data: { request_id: "r", transcript: "  ", metrics: {} } });
    await waitFor(() => segments.length === 2);
    expect(segments[1]).toMatchObject({ text: "", isFinal: false, id: segments[0]!.id });
    await stream.close();
  });

  it("refuses without a key", () => {
    expect(() => new SarvamStt({ ...opts, apiKey: undefined }).open(options([]))).toThrow();
  });
});
