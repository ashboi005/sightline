import { afterEach, describe, expect, it } from "bun:test";
import type { RawTranscriptSegment } from "@sightline/contracts";
import type { ServerWebSocket } from "bun";

import { buildScribeUrl, ElevenLabsStt } from "./elevenlabs-stt";
import type { SttStreamOptions } from "./types";

/** Fake api.elevenlabs.io: token endpoint + realtime socket. */
function fakeElevenLabs() {
  const state = {
    tokenKeys: [] as (string | null)[],
    url: null as URL | null,
    audio: [] as Uint8Array[],
    socket: null as ServerWebSocket<unknown> | null,
  };
  let issued = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/single-use-token/realtime_scribe") {
        state.tokenKeys.push(req.headers.get("xi-api-key"));
        return Response.json({ token: `tok_${++issued}` });
      }
      if (url.pathname === "/v1/speech-to-text/realtime") {
        state.url = url;
        if (srv.upgrade(req)) return;
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        state.socket = ws;
        ws.send(JSON.stringify({ message_type: "session_started", session_id: "s1" }));
      },
      message(_ws, msg) {
        const parsed = JSON.parse(String(msg));
        expect(parsed).toMatchObject({ message_type: "input_audio_chunk", commit: false, sample_rate: 16000 });
        state.audio.push(new Uint8Array(Buffer.from(parsed.audio_base_64, "base64")));
      },
    },
  });
  const send = (msg: unknown) => state.socket!.send(JSON.stringify(msg));
  return { server, state, send, base: `http://localhost:${server.port}` };
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

const options = (segments: RawTranscriptSegment[], errors: Error[] = []): SttStreamOptions => {
  let seq = 3;
  return {
    sessionId: "ses_x",
    format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 },
    keyterms: ["Kirchhoff", "KCL", "Kirchhoff"],
    startedAt: Date.now() - 2000,
    nextSeq: () => seq++,
    onSegment: (s) => segments.push(s),
    onError: (e) => errors.push(e),
  };
};

const base = { apiKey: "xi_key", model: "scribe_v2_realtime", language: "en" as const, vadSilenceSecs: 0.6 };

describe("buildScribeUrl", () => {
  it("sets model, pcm_16000, VAD commits, de-duplicated keyterms and token", () => {
    const url = new URL(buildScribeUrl(base, options([]), "tok"));
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/v1/speech-to-text/realtime");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      model_id: "scribe_v2_realtime",
      language_code: "en",
      audio_format: "pcm_16000",
      commit_strategy: "vad",
      token: "tok",
    });
    expect(url.searchParams.getAll("keyterms")).toEqual(["Kirchhoff", "KCL"]);
    expect(url.searchParams.has("secondary_languages")).toBe(false);
  });

  it("Hinglish = Hindi with English as secondary language", () => {
    const url = new URL(buildScribeUrl({ ...base, language: "hi" }, options([]), "tok"));
    expect(url.searchParams.get("language_code")).toBe("hi");
    expect(url.searchParams.get("secondary_languages")).toBe("en");
  });
});

describe("ElevenLabsStt", () => {
  it("mints a token, streams base64 PCM after session_started, maps partial → committed under one id", async () => {
    const fake = fakeElevenLabs();
    servers.push(fake.server);
    const segments: RawTranscriptSegment[] = [];
    const stream = new ElevenLabsStt({ ...base, baseUrl: fake.base }).open(options(segments));
    stream.push(new Uint8Array([1, 2, 3, 4])); // buffered until session_started
    await waitFor(() => fake.state.audio.length === 1);
    expect(fake.state.tokenKeys).toEqual(["xi_key"]);
    expect(fake.state.url!.searchParams.get("token")).toBe("tok_1");
    expect([...fake.state.audio[0]!]).toEqual([1, 2, 3, 4]);

    fake.send({ message_type: "partial_transcript", text: "kirchhoff's" });
    fake.send({ message_type: "partial_transcript", text: "kirchhoff's current law" });
    fake.send({ message_type: "committed_transcript", text: "Kirchhoff's current law says" });
    fake.send({ message_type: "partial_transcript", text: "next" });
    await waitFor(() => segments.length === 4);
    expect(segments.slice(0, 3).map((s) => [s.id === segments[0]!.id, s.isFinal, s.seq])).toEqual([
      [true, false, 3],
      [true, false, 3],
      [true, true, 3],
    ]);
    expect(segments[2]!.text).toBe("Kirchhoff's current law says");
    expect(segments[3]).toMatchObject({ seq: 4, isFinal: false });

    // Closing with an open line sends trailing silence so VAD commits it.
    const closing = stream.close();
    await waitFor(() => fake.state.audio.length >= 11);
    fake.send({ message_type: "committed_transcript", text: "next class" });
    await closing;
    expect(segments.at(-1)).toMatchObject({ text: "next class", isFinal: true, seq: 4 });
  });

  it("surfaces provider errors and stops on terminal ones", async () => {
    const fake = fakeElevenLabs();
    servers.push(fake.server);
    const errors: Error[] = [];
    const stream = new ElevenLabsStt({ ...base, baseUrl: fake.base }).open(options([], errors));
    await waitFor(() => fake.state.socket !== null);
    fake.send({ message_type: "auth_error", error: "invalid api key" });
    await waitFor(() => errors.length === 1);
    expect(errors[0]!.message).toContain("auth_error");
    await Bun.sleep(400);
    expect(fake.state.tokenKeys.length).toBe(1); // terminal: no reconnect
    await stream.close();
  });

  it("refuses without a key", () => {
    expect(() => new ElevenLabsStt({ ...base, apiKey: undefined }).open(options([]))).toThrow();
  });
});
