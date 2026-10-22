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
  paginated,
  type SessionClientMessage,
} from "@sightline/contracts";
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

for (const type of ["session.ready", "pong", "error", "caption.interim", "caption.final", "caption.refined", "slide.pointer"]) {
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

await call(Session, "POST", `/api/sessions/${session.id}/end`);
await sleep(3500);
const notes = await call(NotesResponse, "GET", `/api/sessions/${session.id}/notes`);
check("notes READY", notes.status === "READY" && notes.notes !== null, notes.notes?.title);
check("ws received notes.status", (seen.get("notes.status") ?? 0) > 0);
const md = await fetch(`${BASE}/api/sessions/${session.id}/notes/export?format=md`);
check("notes export markdown", md.ok && (md.headers.get("content-type") ?? "").includes("markdown"));

ws.close();
const del = await fetch(`${BASE}/api/sessions/${session.id}`, { method: "DELETE" });
check("DELETE session → 204", del.status === 204);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
