/**
 * End-to-end contract smoke test against a running server (mock mode recommended, MOCK_REPLAY_SPEED=4).
 *   bun run --filter server smoke            (SERVER_URL defaults to http://localhost:3000)
 * Every response is parsed with the @sightline/contracts schemas, so this doubles as a contract check.
 */
import {
  ApiError,
  ContextState,
  HealthResponse,
  NotesResponse,
  Session,
  SessionServerMessage,
  SignUtterance,
  SlideDeck,
  Snapshot,
  ListResponse,
  paginated,
  type SessionClientMessage,
} from "@sightline/contracts";
import { createRecordingUploader, createSightlineApi } from "@sightline/contracts/client";
import type { z } from "zod";

const BASE = process.env.SERVER_URL ?? "http://localhost:3000";
const WS_BASE = BASE.replace(/^http/, "ws");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function call<T extends z.ZodType>(schema: T, method: string, path: string, body?: unknown): Promise<z.infer<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  const parsed = schema.safeParse(json);
  check(`${method} ${path} → ${res.status}`, parsed.success, parsed.success ? "" : parsed.error.message.slice(0, 300));
  return parsed.data as z.infer<T>;
}

const health = await call(HealthResponse, "GET", "/api/health");
check("mock speech enabled (needed for replay)", health.mocks.speech);

await call(paginated(Session), "GET", "/api/sessions");
const session = await call(Session, "POST", "/api/sessions", {
  title: "Smoke test lecture",
  mode: "DEAF",
  contextText: "Kirchhoff's laws, KCL, KVL, Ohm's law",
});
await call(ApiError, "POST", "/api/sessions", { title: "" });
await call(ApiError, "GET", "/api/sessions/ses_doesnotexist");

const form = new FormData();
form.append("file", new File([new Uint8Array([37, 80, 68, 70])], "deck.pdf", { type: "application/pdf" }));
await call(SlideDeck, "POST", `/api/sessions/${session.id}/slides`, form);
await sleep(2500);
const deck = await call(SlideDeck, "GET", `/api/sessions/${session.id}/slides`);
check("slides READY", deck.status === "READY", `${deck.slides.length} slides`);
const ctx = await call(ContextState, "GET", `/api/sessions/${session.id}/context`);
check("context READY with glossary", ctx.status === "READY" && ctx.glossary.length > 0, ctx.source);

await call(Session, "POST", `/api/sessions/${session.id}/start`);

const seen = new Map<string, number>();
const ws = new WebSocket(`${WS_BASE}/ws/sessions/${session.id}`);
const send = (m: SessionClientMessage) => ws.send(JSON.stringify(m));
ws.onmessage = (event) => {
  const parsed = SessionServerMessage.safeParse(JSON.parse(String(event.data)));
  if (!parsed.success) check("server message matches contract", false, String(event.data).slice(0, 200));
  else seen.set(parsed.data.type, (seen.get(parsed.data.type) ?? 0) + 1);
};
await new Promise((r) => (ws.onopen = r));
send({ type: "ping", ts: Date.now() });
send({ type: "gaze.transition", transition: { from: "SCREEN", to: "BOARD", targetId: "teacher", ts: Date.now() }, ts: Date.now() });
ws.send(JSON.stringify({ type: "nope" }));
await sleep(12_000);
send({ type: "gaze.transition", transition: { from: "BOARD", to: "SCREEN", targetId: null, ts: Date.now() }, ts: Date.now() });

for (const type of ["session.ready", "pong", "error", "caption.interim", "caption.final", "caption.refined", "slide.pointer", "snapshot.request"]) {
  check(`ws received ${type}`, (seen.get(type) ?? 0) > 0, `${seen.get(type) ?? 0}x`);
}

const utterance = await call(SignUtterance, "POST", `/api/sessions/${session.id}/sign/utterances`, {
  source: "SELF",
  speak: true,
  tokens: ["PLEASE", "REPEAT", "FORMULA"].map((gloss, i) => ({ id: `tok_${i}`, gloss, kind: "SIGN", confidence: 0.9, ts: Date.now() })),
});
check("sign sentence composed", utterance.text.length > 0, utterance.text);
if (utterance.audioUrl) {
  const audio = await fetch(utterance.audioUrl);
  check("TTS audio served", audio.ok, audio.headers.get("content-type") ?? "");
}

const snapForm = new FormData();
snapForm.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])], "board.jpg", { type: "image/jpeg" }));
snapForm.append("trigger", "SPEECH_CUE");
snapForm.append("reason", "Teacher: let me draw an example on the board");
const snap = await call(Snapshot, "POST", `/api/sessions/${session.id}/snapshots`, snapForm);
const badSnap = new FormData();
badSnap.append("file", new File(["x"], "x.txt", { type: "text/plain" }));
badSnap.append("trigger", "MANUAL");
await call(ApiError, "POST", `/api/sessions/${session.id}/snapshots`, badSnap);
const snaps = await call(ListResponse(Snapshot), "GET", `/api/sessions/${session.id}/snapshots`);
check("snapshot listed", snaps.data.some((s) => s.id === snap.id));
await sleep(100);
check("ws received snapshot.captured", (seen.get("snapshot.captured") ?? 0) > 0);

// Recording via presigned uploads (what the web app's recorder does).
const api = createSightlineApi({ baseUrl: BASE });
const uploader = await createRecordingUploader(api, session.id, { contentType: "video/webm" });
const fakeVideo = new Blob([new Uint8Array(4096).map((_, i) => i % 251)], { type: "video/webm" });
uploader.addSegment(fakeVideo, { startMs: 0, durationMs: 5_000 });
uploader.addSegment(fakeVideo, { startMs: 5_000, durationMs: 5_000 });
const finished = await uploader.finish();
check("recording READY with 2 uploaded segments", finished.recording.status === "READY" && finished.uploaded.length === 2, `failures: ${finished.failures.length}`);
const recordings = await api.listRecordings(session.id);
const segUrl = recordings.data[0]?.segments[0]?.url;
check("recording listed with presigned playback URL", Boolean(segUrl), segUrl?.slice(0, 60));
if (segUrl) {
  const ranged = await fetch(segUrl, { headers: { range: "bytes=0-99" } });
  check("playback URL serves byte ranges (seekable video)", ranged.status === 206 && (await ranged.arrayBuffer()).byteLength === 100);
  const tampered = await fetch(segUrl.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
  check("tampered playback URL is rejected", tampered.status === 403);
}

await call(Session, "POST", `/api/sessions/${session.id}/end`);
await sleep(3500);
const notes = await call(NotesResponse, "GET", `/api/sessions/${session.id}/notes`);
check("notes READY", notes.status === "READY" && notes.notes !== null, notes.notes?.title);
const imageBlocks = notes.notes?.sections.flatMap((sec) => sec.blocks).filter((b) => b.type === "image") ?? [];
check("snapshot placed in notes", imageBlocks.some((b) => b.type === "image" && b.snapshotId === snap.id), `${imageBlocks.length} image block(s)`);
check("ws received notes.status", (seen.get("notes.status") ?? 0) > 0);
const md = await fetch(`${BASE}/api/sessions/${session.id}/notes/export?format=md`);
check("notes export markdown", md.ok && (md.headers.get("content-type") ?? "").includes("markdown"));

ws.close();
const del = await fetch(`${BASE}/api/sessions/${session.id}`, { method: "DELETE" });
check("DELETE session → 204", del.status === 204);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
