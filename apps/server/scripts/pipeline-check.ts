/**
 * Core pipeline check WITHOUT any API keys: real DeepgramStt + real caption engine wiring, with Deepgram replaced
 * by a local fake that "transcribes" the Kirchhoff script whenever audio arrives.
 *
 *   bun run --filter server check:pipeline
 *
 * Spawns the server with MOCK_SPEECH=false / MOCK_CAPTIONS=false and DEEPGRAM_URL pointing at the fake, streams
 * LINEAR16 audio over the session socket the way @sightline/live-client does, and asserts captions come back.
 */
import { SessionServerMessage } from "@sightline/contracts";
import { floatToLinear16 } from "@sightline/live-client";
import { fixtures } from "@sightline/mocks";

const SERVER_PORT = 13100;
const lines = fixtures.lecture.script.segments.slice(0, 3);

// --- fake Deepgram -----------------------------------------------------------
let audioBytes = 0;
let auth: string | null = null;
let keyterms: string[] = [];
const fake = Bun.serve({
  port: 0,
  fetch(req, server) {
    auth = req.headers.get("authorization");
    keyterms = new URL(req.url).searchParams.getAll("keyterm");
    if (server.upgrade(req)) return;
    return new Response("upgrade required", { status: 426 });
  },
  websocket: {
    message(ws, msg) {
      if (typeof msg === "string") {
        if (JSON.parse(msg).type === "CloseStream") ws.close(1000);
        return;
      }
      const before = audioBytes;
      audioBytes += msg.byteLength;
      // Every ~0.5 s of audio, emit an interim + final for the next scripted line.
      const index = Math.floor(audioBytes / 16000) - 1;
      if (index >= 0 && index < lines.length && Math.floor(before / 16000) - 1 < index) {
        const raw = lines[index]!.raw;
        const result = (text: string, isFinal: boolean) =>
          ws.send(JSON.stringify({ type: "Results", start: index, duration: 1, is_final: isFinal, channel: { alternatives: [{ transcript: text, confidence: 0.9 }] } }));
        result(raw.split(" ").slice(0, 3).join(" "), false);
        result(raw, true);
      }
    },
  },
});

// --- server under test ---------------------------------------------------------
const server = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: `${import.meta.dir}/..`,
  env: {
    ...process.env,
    PORT: String(SERVER_PORT),
    PUBLIC_SERVER_URL: `http://localhost:${SERVER_PORT}`,
    USE_MOCK_DATA: "true",
    MOCK_SPEECH: "false",
    MOCK_CAPTIONS: "false",
    DEEPGRAM_API_KEY: "fake-key",
    DEEPGRAM_URL: `ws://localhost:${fake.port}`,
    CAPTION_TIMEOUT_MS: "1500",
  },
  stdout: "ignore",
  stderr: "ignore",
});

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  const base = `http://localhost:${SERVER_PORT}`;
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) break;
    await Bun.sleep(200);
  }
  const health = await (await fetch(`${base}/api/health`)).json();
  check("server up with real speech + captions", !health.mocks.speech && !health.mocks.captions);

  const session = await (await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "pipeline check" }) })).json();
  await fetch(`${base}/api/sessions/${session.id}/start`, { method: "POST" });

  const seen: SessionServerMessage[] = [];
  const ws = new WebSocket(`ws://localhost:${SERVER_PORT}/ws/sessions/${session.id}`);
  ws.onmessage = (e) => {
    const parsed = SessionServerMessage.safeParse(JSON.parse(String(e.data)));
    if (parsed.success) seen.push(parsed.data);
    else check("message matches contract", false, String(e.data).slice(0, 120));
  };
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: "audio.start", format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 }, ts: Date.now() }));
  // 2 s of a quiet tone in 100 ms LINEAR16 frames, paced in real time.
  for (let i = 0; i < 20; i++) {
    const chunk = Float32Array.from({ length: 1600 }, (_, j) => 0.05 * Math.sin(((i * 1600 + j) * 2 * Math.PI * 220) / 16000));
    ws.send(floatToLinear16(chunk));
    await Bun.sleep(100);
  }
  await Bun.sleep(2500);
  ws.send(JSON.stringify({ type: "audio.stop", ts: Date.now() }));
  await Bun.sleep(300);

  const types = (t: string) => seen.filter((m) => m.type === t);
  check("fake Deepgram got Token auth", auth === "Token fake-key", String(auth));
  check("keyterms from the glossary reached Deepgram", keyterms.includes("Kirchhoff"), keyterms.slice(0, 4).join(", "));
  check("LINEAR16 audio reached Deepgram", audioBytes >= 20 * 3200, `${audioBytes} bytes`);
  check("caption.interim received", types("caption.interim").length >= 3, `${types("caption.interim").length}`);
  check("caption.final received", types("caption.final").length === 3, `${types("caption.final").length}`);
  const refined = types("caption.refined") as Extract<SessionServerMessage, { type: "caption.refined" }>[];
  check("caption.refined received (LLM without key → glossary fallback)", refined.length === 3, `${refined.length}`);
  const first = refined.find((m) => m.segment.rawText.includes("kerchief"));
  check("glossary correction applied", Boolean(first?.segment.text.includes("Kirchhoff")), first?.segment.text);
  const transcript = await (await fetch(`${base}/api/sessions/${session.id}/transcript`)).json();
  check("transcript persisted, ordered by seq", transcript.data.length === 3 && transcript.data[0].seq === 0, `${transcript.data.length}`);
  ws.close();
} finally {
  server.kill();
  fake.stop(true);
}

console.log(failures === 0 ? "\nPIPELINE OK" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
