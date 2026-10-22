import { afterEach, describe, expect, it } from "bun:test";
import type { RawTranscriptSegment } from "@sightline/contracts";
import type { ServerWebSocket } from "bun";

import { buildDeepgramUrl, DeepgramStt } from "./deepgram-stt";
import type { SttStreamOptions } from "./types";

/** A tiny stand-in for wss://api.deepgram.com/v1/listen. */
function fakeDeepgram() {
  const state = {
    authorization: null as string | null,
    url: null as URL | null,
    audio: [] as Uint8Array[],
    control: [] as string[],
    socket: null as ServerWebSocket<unknown> | null,
  };
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      state.authorization = req.headers.get("authorization");
      state.url = new URL(req.url);
      if (srv.upgrade(req)) return;
      return new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        state.socket = ws;
      },
      message(ws, msg) {
        if (typeof msg === "string") {
          state.control.push(JSON.parse(msg).type);
          if (JSON.parse(msg).type === "CloseStream") ws.close(1000, "done");
        } else state.audio.push(new Uint8Array(msg));
      },
    },
  });
  const results = (text: string, isFinal: boolean, start = 0.5, duration = 1) =>
    state.socket!.send(
      JSON.stringify({
        type: "Results",
        start,
        duration,
        is_final: isFinal,
        speech_final: isFinal,
        channel: { alternatives: [{ transcript: text, confidence: 0.91 }] },
      }),
    );
  return { server, state, results, base: `ws://localhost:${server.port}` };
}

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await Bun.sleep(10);
  }
};

let servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => {
  for (const s of servers) s.stop(true);
  servers = [];
});

function streamOptions(segments: RawTranscriptSegment[], errors: Error[] = []): SttStreamOptions {
  let seq = 7;
  return {
    sessionId: "ses_test",
    format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 },
    keyterms: ["Kirchhoff", "KCL", "Kirchhoff", " "],
    startedAt: Date.now() - 10_000,
    nextSeq: () => seq++,
    onSegment: (s) => segments.push(s),
    onError: (e) => errors.push(e),
  };
}

describe("buildDeepgramUrl", () => {
  it("adds linear16 params and de-duplicated keyterms for nova-3 only", () => {
    const opts = { apiKey: "k", model: "nova-3", language: "en" };
    const url = new URL(buildDeepgramUrl("wss://api.deepgram.com", opts, streamOptions([])));
    expect(url.pathname).toBe("/v1/listen");
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("interim_results")).toBe("true");
    expect(url.searchParams.getAll("keyterm")).toEqual(["Kirchhoff", "KCL"]);
    const nova2 = new URL(buildDeepgramUrl("wss://x", { ...opts, model: "nova-2" }, streamOptions([])));
    expect(nova2.searchParams.getAll("keyterm")).toEqual([]);
  });
});

describe("DeepgramStt", () => {
  it("authenticates, forwards audio, and maps interim → final under one segment id", async () => {
    const dg = fakeDeepgram();
    servers.push(dg.server);
    const segments: RawTranscriptSegment[] = [];
    const stt = new DeepgramStt({ apiKey: "secret", model: "nova-3", language: "en", baseUrl: dg.base });

    const stream = stt.open(streamOptions(segments));
    stream.push(new Uint8Array([1, 2, 3, 4])); // buffered until open
    await waitFor(() => dg.state.socket !== null && dg.state.audio.length === 1);
    expect(dg.state.authorization).toBe("Token secret");
    expect(dg.state.url!.searchParams.getAll("keyterm")).toEqual(["Kirchhoff", "KCL"]);

    stream.push(new Uint8Array([5, 6]));
    await waitFor(() => dg.state.audio.length === 2);

    dg.results("kirchhoff's", false);
    dg.results("kirchhoff's current law", false);
    dg.results("kirchhoff's current law says", true);
    dg.results("next", false, 2, 0.3);
    await waitFor(() => segments.length === 4);

    const [a, b, c, d] = segments;
    expect(a!.id).toBe(b!.id);
    expect(b!.id).toBe(c!.id);
    expect([a!.isFinal, b!.isFinal, c!.isFinal]).toEqual([false, false, true]);
    expect(c!.text).toBe("kirchhoff's current law says");
    expect(c!.seq).toBe(7);
    expect(d!.id).not.toBe(c!.id);
    expect(d!.seq).toBe(8);
    expect(c!.startMs).toBeGreaterThanOrEqual(10_000); // offset from session start, not stream start

    await stream.close();
    expect(dg.state.control).toContain("CloseStream");
  });

  it("clears the interim line when a final result comes back empty", async () => {
    const dg = fakeDeepgram();
    servers.push(dg.server);
    const segments: RawTranscriptSegment[] = [];
    const stream = new DeepgramStt({ apiKey: "k", model: "nova-3", language: "en", baseUrl: dg.base }).open(
      streamOptions(segments),
    );
    await waitFor(() => dg.state.socket !== null);
    dg.results("uh", false);
    dg.results("", true);
    await waitFor(() => segments.length === 2);
    expect(segments[1]).toMatchObject({ text: "", isFinal: false, id: segments[0]!.id });
    await stream.close();
  });

  it("sends KeepAlive while no audio flows", async () => {
    const dg = fakeDeepgram();
    servers.push(dg.server);
    const stream = new DeepgramStt({ apiKey: "k", model: "nova-3", language: "en", baseUrl: dg.base, keepAliveMs: 50 }).open(
      streamOptions([]),
    );
    await waitFor(() => dg.state.control.includes("KeepAlive"), 3000);
    await stream.close();
  });

  it("refuses to open without an API key", () => {
    expect(() => new DeepgramStt({ apiKey: undefined, model: "nova-3", language: "en" }).open(streamOptions([]))).toThrow();
  });
});
