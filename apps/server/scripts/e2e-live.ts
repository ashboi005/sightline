export {};
/**
 * Live end-to-end check against a running server with EVERYTHING real (USE_MOCK_DATA=false):
 * better-auth + Postgres, S3, Qdrant + Gemini embeddings, Merge GLM (captions, glossary, sign, notes, vision),
 * ElevenLabs/Sarvam STT + TTS, poppler slides.
 *   USE_MOCK_DATA=false bun run dev            (in another shell)
 *   bun run --filter server check:e2e          (SERVER_URL defaults to http://localhost:3000)
 *
 * Speaks the Kirchhoff lecture with ElevenLabs TTS and streams it as 16 kHz PCM over the session socket, exactly
 * like the browser mic does. Creates a throwaway user + session and deletes the session at the end.
 */
import "varlock/auto-load";

import {
  CaptionSegment,
  ContextState,
  NotesResponse,
  Session,
  SessionServerMessage,
  SignUtterance,
  SlideDeck,
  Snapshot,
  ListResponse,
  type SessionClientMessage,
} from "@sightline/contracts";
import { createRecordingUploader, createSightlineApi } from "@sightline/contracts/client";
import { fixtures } from "@sightline/mocks";
import type { z } from "zod";

import { ENV } from "../src/env";

const BASE = process.env.SERVER_URL ?? "http://localhost:3000";
const ORIGIN = process.env.WEB_ORIGIN ?? ENV.CORS_ORIGIN;
const WS_BASE = BASE.replace(/^http/, "ws");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const section = (title: string) => console.log(`\n— ${title}`);
async function poll<V>(load: () => Promise<V>, done: (v: V) => boolean, timeoutMs: number): Promise<V> {
  const deadline = Date.now() + timeoutMs;
  let value = await load();
  while (!done(value) && Date.now() < deadline) {
    await sleep(500);
    value = await load();
  }
  return value;
}

// --- auth: a throwaway user, cookie jar for the API origin only -------------------------------------------
let cookie = "";
const authedFetch: typeof fetch = Object.assign(
  (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(BASE)) return fetch(input, init); // presigned S3 URLs: no cookie, like the browser
    const headers = new Headers(init.headers);
    headers.set("origin", ORIGIN);
    if (cookie) headers.set("cookie", cookie);
    return fetch(input, { ...init, headers, redirect: init.redirect ?? "manual" });
  },
  { preconnect: fetch.preconnect },
);
async function call<T extends z.ZodType>(schema: T, method: string, path: string, body?: unknown, expectStatus?: number): Promise<z.infer<T>> {
  const res = await authedFetch(`${BASE}${path}`, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  const parsed = schema.safeParse(json);
  const ok = parsed.success && (expectStatus === undefined || res.status === expectStatus);
  if (!ok) check(`${method} ${path} → ${res.status}`, false, parsed.success ? "" : JSON.stringify(json).slice(0, 300));
  if (!parsed.success) throw new Error(`Invalid response from ${method} ${path}`);
  return parsed.data as z.infer<T>;
}

section("health + auth");
const health = (await (await fetch(`${BASE}/api/health`)).json()) as { mocks: Record<string, boolean> };
const mocked = Object.entries(health.mocks).filter(([, on]) => on).map(([name]) => name);
check("server runs with every module real (no mocks)", mocked.length === 0, mocked.length ? `mocked: ${mocked.join(", ")}` : "");

const stamp = Date.now();
const signUp = await authedFetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "E2E Student", email: `e2e+${stamp}@sightline.dev`, password: `e2e-password-${stamp}` }),
});
cookie = signUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
check("sign-up → session cookie", signUp.ok && cookie.length > 0, String(signUp.status));
const me = (await (await authedFetch(`${BASE}/api/me`)).json()) as { isMock?: boolean; email?: string };
check("/api/me is the real user", me.isMock === false, me.email);
const api = createSightlineApi({ baseUrl: BASE, fetch: authedFetch });

const qdrantGet = async (path: string) => {
  const res = await fetch(`${ENV.QDRANT_URL.replace(/\/$/, "")}${path}`, { headers: { "api-key": ENV.QDRANT_API_KEY ?? "" } });
  const text = await res.text();
  try {
    return JSON.parse(text) as { result?: { collections?: { name: string }[]; aliases?: { alias_name: string }[] } };
  } catch {
    throw new Error(`Qdrant ${path} → ${res.status}: ${text.slice(0, 120)}`);
  }
};
section("session + context (Qdrant, Gemini embeddings, GLM glossary)");
const contextText = [
  "Kirchhoff's current law (KCL): the algebraic sum of currents at a node is zero; charge is conserved.",
  "Kirchhoff's voltage law (KVL): the sum of voltages around any closed loop is zero; energy is conserved.",
  "Ohm's law: V = I R. Power dissipated in a resistor P = I^2 R. Charge Q = integral of i dt.",
  "Mesh analysis applies KVL to each independent loop of a planar circuit.",
].join("\n");
let t = Date.now();
const session = await call(Session, "POST", "/api/sessions", { title: "E2E — Kirchhoff's laws", mode: "DEAF", contextText }, 201);
check("create session (201)", session.status === "DRAFT", session.id);
const ctx = await poll(() => call(ContextState, "GET", `/api/sessions/${session.id}/context`), (c) => c.status === "READY" || c.status === "FAILED", 120_000);
check("context READY", ctx.status === "READY", `${Date.now() - t} ms, ${ctx.chunkCount} chunk(s), source=${ctx.source}, error=${ctx.error ?? "-"}`);
check("GLM glossary extracted", ctx.glossary.length > 0, ctx.glossary.map((g) => g.term).slice(0, 8).join(", "));
const sessionCollections = async () => ((await qdrantGet("/collections")).result?.collections ?? []).filter((c) => c.name.startsWith(`ctx_${session.id}`));
check("context vectors live in Qdrant", (await sessionCollections()).length === 1, (await sessionCollections()).map((c) => c.name).join(","));

section("slides (real PDF → poppler → S3 assets)");
const form = new FormData();
form.append("file", new File([lectureDeckPdf()], "kirchhoff.pdf", { type: "application/pdf" }));
t = Date.now();
await call(SlideDeck, "POST", `/api/sessions/${session.id}/slides`, form);
const deck = await poll(() => call(SlideDeck, "GET", `/api/sessions/${session.id}/slides`), (d) => d.status === "READY" || d.status === "FAILED", 180_000);
check("slides READY", deck.status === "READY" && deck.slides.length === fixtures.lecture.slides.slides.length, `${Date.now() - t} ms, ${deck.slides.length} slides, error=${deck.error ?? "-"}`);
let slidePng: Uint8Array | null = null;
const slideUrl = deck.slides[2]?.imageUrl;
if (slideUrl) {
  const redirect = await authedFetch(slideUrl);
  const location = redirect.headers.get("location") ?? "";
  check("slide image → 302 to presigned S3 GET", redirect.status === 302 && /X-Amz-Signature/.test(location), `${redirect.status} ${new URL(location || BASE).host}`);
  const image = await fetch(location);
  slidePng = new Uint8Array(await image.arrayBuffer());
  check("S3 serves the slide PNG", image.ok && slidePng[0] === 0x89 && slidePng[1] === 0x50, `${slidePng.length} bytes`);
  const anon = await fetch(slideUrl, { redirect: "manual" });
  check("slide image without a cookie → 401", anon.status === 401, String(anon.status));
}
// Context is re-ingested with the slide text once slides land; wait so captions see the final glossary.
await poll(() => call(ContextState, "GET", `/api/sessions/${session.id}/context`), (c) => c.status === "READY" || c.status === "FAILED", 120_000);

section("live captions (ElevenLabs TTS → PCM → session socket → STT → GLM refine → slide pointer)");
await call(Session, "POST", `/api/sessions/${session.id}/start`);
const lines = [0, 2, 4, 5, 7, 10, 13, 14].map((i) => fixtures.lecture.script.segments[i]!.raw);
const speech: Uint8Array[] = [];
for (const line of lines) speech.push(await speak(line));
const totalSec = speech.reduce((n, pcm) => n + pcm.length, 0) / 32000;
console.log(`  speaking ${lines.length} lecture lines (${totalSec.toFixed(1)} s of audio)`);

const seen = new Map<string, number>();
const messages: SessionServerMessage[] = [];
const ws = new WebSocket(`${WS_BASE}/ws/sessions/${session.id}`, { headers: { origin: ORIGIN, cookie } } as never);
ws.onmessage = (event) => {
  const parsed = SessionServerMessage.safeParse(JSON.parse(String(event.data)));
  if (!parsed.success) return check("server message matches contract", false, String(event.data).slice(0, 200));
  messages.push(parsed.data);
  seen.set(parsed.data.type, (seen.get(parsed.data.type) ?? 0) + 1);
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const send = (m: SessionClientMessage) => ws.send(JSON.stringify(m));
await poll(async () => seen.get("session.ready") ?? 0, (n) => n > 0, 5_000);
const ready = messages.find((m) => m.type === "session.ready");
check("session.ready (live, not replay)", ready?.type === "session.ready" && !ready.isReplay);

send({ type: "audio.start", format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 }, ts: Date.now() });
const audioStart = Date.now();
for (const [i, pcm] of speech.entries()) {
  if (i === 4) send({ type: "gaze.transition", transition: { from: "SCREEN", to: "BOARD", targetId: "teacher", ts: Date.now() }, ts: Date.now() });
  const padded = new Uint8Array(pcm.length + 32000); // 1 s pause between sentences so VAD commits each line
  padded.set(pcm);
  for (let o = 0; o < padded.length; o += 3200) {
    ws.send(padded.subarray(o, o + 3200));
    await sleep(100);
  }
}
send({ type: "gaze.transition", transition: { from: "BOARD", to: "SCREEN", targetId: null, ts: Date.now() }, ts: Date.now() });
send({ type: "audio.stop", ts: Date.now() });
await poll(async () => ({ f: seen.get("caption.final") ?? 0, r: seen.get("caption.refined") ?? 0 }), ({ f, r }) => f >= lines.length - 1 && r >= f, 30_000);

const finals = messages.flatMap((m) => (m.type === "caption.final" ? [m.segment] : []));
const refined = new Map(messages.flatMap((m) => (m.type === "caption.refined" ? [[m.segment.id, m.segment] as const] : [])));
for (const type of ["caption.interim", "caption.final", "caption.refined", "slide.pointer", "snapshot.request"]) {
  check(`ws ${type}`, (seen.get(type) ?? 0) > 0, `${seen.get(type) ?? 0}x`);
}
check("one final caption per spoken line", finals.length >= lines.length - 1, `${finals.length}/${lines.length}`);
const firstFinal = messages.find((m) => m.type === "caption.final");
check("first final caption latency", !!firstFinal, firstFinal ? `${firstFinal.ts - audioStart} ms after audio start` : "");
const llmRefined = [...refined.values()].filter((s) => s.corrections.length > 0 || s.parts.some((p) => p.type === "formula"));
check("GLM refinement corrected / formatted captions", llmRefined.length > 0, `${llmRefined.length}/${refined.size} refined with corrections or formulas`);
for (const s of finals) {
  const r = refined.get(s.id);
  console.log(`    raw:     ${s.text.slice(0, 110)}`);
  console.log(`    refined: ${(r?.parts.map((p) => (p.type === "formula" ? `$${p.latex}$` : p.text)).join("") ?? "—").slice(0, 110)}`);
}
check("formula rendered (KaTeX part)", [...refined.values()].some((s) => s.parts.some((p) => p.type === "formula")));
const kirchhoff = [...refined.values()].some((s) => /Kirchhoff/.test(s.text));
check("domain term corrected to 'Kirchhoff'", kirchhoff);
const pointers = messages.flatMap((m) => (m.type === "slide.pointer" ? [m.pointer.slideIndex] : []));
check("slide pointer moved through the deck", new Set(pointers).size >= 2, `slides: ${[...new Set(pointers)].join(" → ")}`);
const cue = messages.find((m) => m.type === "snapshot.request");
check("visual cue → snapshot.request", cue?.type === "snapshot.request", cue?.type === "snapshot.request" ? `${cue.trigger}: ${cue.reason}` : "");
const transcript = await call(ListResponse(CaptionSegment), "GET", `/api/sessions/${session.id}/transcript`);
check("transcript persisted in Postgres", transcript.data.length >= finals.length, `${transcript.data.length} segments`);

section("sign → sentence (GLM) → speech (TTS) → S3");
t = Date.now();
const utterance = await call(SignUtterance, "POST", `/api/sessions/${session.id}/sign/utterances`, {
  source: "SELF",
  speak: true,
  tokens: ["PLEASE", "REPEAT", "FORMULA"].map((gloss, i) => ({ id: `tok_${i}`, gloss, kind: "SIGN", confidence: 0.9, ts: Date.now() })),
});
check("sign sentence composed", utterance.text.length > 0, `${Date.now() - t} ms: "${utterance.text}"`);
if (utterance.audioUrl) {
  const redirect = await authedFetch(utterance.audioUrl);
  const audio = await fetch(redirect.headers.get("location") ?? "");
  check("TTS audio stored in S3 and served via presigned GET", redirect.status === 302 && audio.ok, `${audio.headers.get("content-type")} ${(await audio.arrayBuffer()).byteLength} bytes`);
} else check("TTS audio URL", false, "no audioUrl");
await sleep(300);
check("ws sign.utterance broadcast", (seen.get("sign.utterance") ?? 0) > 0);

section("snapshot (S3 + GLM vision description)");
const snapForm = new FormData();
snapForm.append("file", new File([slidePng ?? new Uint8Array()], "board.png", { type: "image/png" }));
snapForm.append("trigger", cue?.type === "snapshot.request" ? cue.trigger : "SPEECH_CUE");
snapForm.append("reason", "Teacher: let me draw an example on the board");
if (cue?.type === "snapshot.request" && cue.segmentId) snapForm.append("segmentId", cue.segmentId);
const snap = await call(Snapshot, "POST", `/api/sessions/${session.id}/snapshots`, snapForm, 201);
check("snapshot stored", Boolean(snap.imageUrl), snap.id);
const described = await poll(
  () => call(ListResponse(Snapshot), "GET", `/api/sessions/${session.id}/snapshots`),
  (l) => Boolean(l.data.find((s) => s.id === snap.id)?.description),
  60_000,
);
check("GLM vision described the snapshot", Boolean(described.data.find((s) => s.id === snap.id)?.description), described.data.find((s) => s.id === snap.id)?.description?.slice(0, 140) ?? "");

section("recording (presigned S3 PUT → playback)");
const uploader = await createRecordingUploader(api, session.id, { contentType: "video/webm" });
const fakeVideo = new Blob([new Uint8Array(64 * 1024).map((_, i) => i % 251)], { type: "video/webm" });
uploader.addSegment(fakeVideo, { startMs: 0, durationMs: 5_000 });
uploader.addSegment(fakeVideo, { startMs: 5_000, durationMs: 5_000 });
const finished = await uploader.finish();
check("recording READY with 2 segments uploaded straight to S3", finished.recording.status === "READY" && finished.uploaded.length === 2, `failures: ${finished.failures.length}`);
const recordings = await api.listRecordings(session.id);
const segUrl = recordings.data[0]?.segments[0]?.url;
check("recording listed with presigned S3 playback URL", Boolean(segUrl && /X-Amz-Signature/.test(segUrl)), segUrl ? new URL(segUrl).host : "");
if (segUrl) {
  const ranged = await fetch(segUrl, { headers: { range: "bytes=0-99" } });
  check("S3 playback serves byte ranges (seekable)", ranged.status === 206 && (await ranged.arrayBuffer()).byteLength === 100, String(ranged.status));
  const tampered = await fetch(segUrl.replace(/X-Amz-Signature=([0-9a-f])/, (_, c) => `X-Amz-Signature=${c === "a" ? "b" : "a"}`));
  check("tampered playback URL is rejected by S3", tampered.status === 403, String(tampered.status));
}

section("end → notes (GLM + Qdrant) → export");
t = Date.now();
await call(Session, "POST", `/api/sessions/${session.id}/end`);
const notes = await poll(() => call(NotesResponse, "GET", `/api/sessions/${session.id}/notes`), (n) => n.status === "READY" || n.status === "FAILED", 300_000);
check("notes READY", notes.status === "READY" && notes.notes !== null, `${Date.now() - t} ms, ${notes.notes?.sections.length ?? 0} sections: ${notes.notes?.title ?? notes.error ?? ""}`);
for (const s of notes.notes?.sections ?? []) console.log(`    § ${s.heading} (${s.blocks.length} blocks, ${s.sourceSegmentIds.length} source segs)`);
const imageBlocks = notes.notes?.sections.flatMap((s) => s.blocks).filter((b) => b.type === "image") ?? [];
check("snapshot placed in the notes", imageBlocks.some((b) => b.type === "image" && b.snapshotId === snap.id), `${imageBlocks.length} image block(s)`);
check("notes cite real transcript segments", (notes.notes?.sections ?? []).some((s) => s.sourceSegmentIds.length > 0));
await sleep(300);
check("ws notes.status", (seen.get("notes.status") ?? 0) > 0);
const md = await authedFetch(`${BASE}/api/sessions/${session.id}/notes/export?format=md`);
const mdText = await md.text();
check("markdown export (portable, images embedded)", md.ok && mdText.length > 200 && /data:image\//.test(mdText), `${mdText.length} chars`);
ws.close();

section("delete → Postgres + S3 + Qdrant cleanup");
const assetUrl = utterance.audioUrl ?? slideUrl;
const del = await authedFetch(`${BASE}/api/sessions/${session.id}`, { method: "DELETE" });
check("DELETE session → 204", del.status === 204, String(del.status));
check("session gone", (await authedFetch(`${BASE}/api/sessions/${session.id}`)).status === 404);
if (assetUrl) check("session assets gone", (await authedFetch(assetUrl)).status === 404);
if (segUrl) {
  const gone = await poll(async () => (await fetch(segUrl)).status, (s) => s === 404 || s === 403, 15_000);
  check("recording objects deleted from S3", gone === 404 || gone === 403, String(gone));
}
const prefix = `ctx_${session.id}`;
const leftCollections = ((await qdrantGet("/collections")).result?.collections ?? []).filter((c) => c.name.startsWith(prefix));
const leftAliases = ((await qdrantGet("/aliases")).result?.aliases ?? []).filter((a) => a.alias_name.startsWith(prefix));
check("Qdrant collection + alias for the session dropped", leftCollections.length === 0 && leftAliases.length === 0, `${leftCollections.length} collection(s), ${leftAliases.length} alias(es) left`);

console.log(failures === 0 ? "\nLIVE E2E OK" : `\n${failures} LIVE E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

// --- helpers --------------------------------------------------------------------------------------------------
async function speak(text: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ENV.ELEVENLABS_VOICE_ID)}?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": ENV.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: ENV.ELEVENLABS_MODEL_ID }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The Kirchhoff deck as a real multi-page PDF (one page per fixture slide). */
function lectureDeckPdf(): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "-");
  const slides = fixtures.lecture.slides.slides;
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: string[] = [];
  for (const s of slides) {
    const stream = [`BT /F1 32 Tf 60 520 Td (${esc(s.title)}) Tj /F1 18 Tf`, ...s.bullets.map((b) => `0 -40 Td (${esc(`- ${b}`)}) Tj`), "ET"].join(" ");
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contents = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let content = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, o] of objects.entries()) {
    offsets.push(content.length);
    content += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(content);
}
