export {};
/**
 * Rehearse the demo lecture against a running server with everything real, before doing it live.
 *   bun run live                          (or any server with USE_MOCK_DATA=false)
 *   bun run --filter server demo:rehearse [-- --keep]     SERVER_URL defaults to http://localhost:3000
 *
 * Plays the teacher: uploads docs/demo/quadratic-equations.pdf, speaks every line of scripts/demo-lecture.ts with
 * ElevenLabs TTS into the session socket (exactly like the browser mic), moves the student's gaze at the cues,
 * sends the signed question and a board snapshot, ends the lecture and prints what the student would see:
 * glossary, every caption raw → formatted, slide changes, notes. --keep leaves the session and prints a login.
 */
import "varlock/auto-load";

import { ContextState, ListResponse, NotesResponse, Session, SessionServerMessage, SignUtterance, SlideDeck, Snapshot, type CaptionSegment, type SessionClientMessage } from "@sightline/contracts";
import type { z } from "zod";

import { ENV } from "../src/env";
import { DEMO } from "./demo-lecture";
import { textDeckPdf } from "./fixtures";

const BASE = process.env.SERVER_URL ?? "http://localhost:3000";
const ORIGIN = process.env.WEB_ORIGIN ?? ENV.CORS_ORIGIN;
const keep = process.argv.includes("--keep");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const render = (segment: CaptionSegment) => segment.parts.map((p) => (p.type === "formula" ? green(`⟦${p.latex}⟧`) : p.type === "term" ? bold(p.text) : p.text)).join("");

let cookie = "";
const http = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...init.headers } });
async function json<T extends z.ZodType>(schema: T, path: string, init?: RequestInit): Promise<z.infer<T>> {
  const res = await http(path, init);
  const body = await res.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return parsed.data;
}
async function poll<V>(load: () => Promise<V>, done: (v: V) => boolean, ms: number) {
  const end = Date.now() + ms;
  let v = await load();
  while (!done(v) && Date.now() < end) { await sleep(700); v = await load(); }
  return v;
}
async function speak(text: string, attempt = 0): Promise<Uint8Array> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ENV.ELEVENLABS_VOICE_ID)}?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": ENV.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: ENV.ELEVENLABS_MODEL_ID }),
  });
  if (res.status === 429 && attempt < 5) {
    await sleep(1500 * (attempt + 1)); // concurrency limit: back off and retry
    return speak(text, attempt + 1);
  }
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// --- before class --------------------------------------------------------------------------------------------------
const stamp = Date.now();
const login = { name: "Demo Student", email: `demo+${stamp}@sightline.dev`, password: `demo-${stamp}` };
const signUp = await http("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify(login) });
if (!signUp.ok) throw new Error(`sign-up failed: ${signUp.status}`);
cookie = signUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

console.log(bold("\nBefore class — the student sets up the lecture"));
let t = Date.now();
const session = await json(Session, "/api/sessions", { method: "POST", body: JSON.stringify({ title: DEMO.title, subject: DEMO.subject, mode: "DEAF" }) });
const form = new FormData();
form.append("file", new File([textDeckPdf(DEMO.slides)], "quadratic-equations.pdf", { type: "application/pdf" }));
await json(SlideDeck, `/api/sessions/${session.id}/slides`, { method: "POST", body: form });
const deck = await poll(() => json(SlideDeck, `/api/sessions/${session.id}/slides`), (d) => d.status !== "PROCESSING", 120_000);
console.log(`  slides ${deck.status}: ${deck.slides.length} pages in ${((Date.now() - t) / 1000).toFixed(1)} s`);
const ctx = await poll(() => json(ContextState, `/api/sessions/${session.id}/context`), (c) => c.status === "READY" || c.status === "FAILED", 120_000);
console.log(`  context ${ctx.status} after ${((Date.now() - t) / 1000).toFixed(1)} s — glossary:`);
for (const term of ctx.glossary) console.log(`    ${bold(term.term)}${term.aliases.length ? dim(`  ← ${term.aliases.join(", ")}`) : ""}`);

try {
  // --- the lecture ---------------------------------------------------------------------------------------------------
  await json(Session, `/api/sessions/${session.id}/start`, { method: "POST" });
  const messages: SessionServerMessage[] = [];
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/sessions/${session.id}`, { headers: { origin: ORIGIN, cookie } } as never);
  ws.onmessage = (e) => {
    const parsed = SessionServerMessage.safeParse(JSON.parse(String(e.data)));
    if (parsed.success) messages.push(parsed.data);
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (m: SessionClientMessage) => ws.send(JSON.stringify(m));

  console.log(bold(`\nThe lecture — ${DEMO.lines.length} lines (pre-generating the teacher's voice…)`));
  const audio: Uint8Array[] = [];
  for (const line of DEMO.lines) audio.push(await speak(line.say)); // sequential: ElevenLabs limits concurrent requests
  send({ type: "audio.start", format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 }, ts: Date.now() });
  const audioStart = Date.now();
  // Like the script says: wait ~2 s after the mic turns on (speech-to-text is still connecting).
  for (let o = 0; o < 64_000; o += 3200) { ws.send(new Uint8Array(3200)); await sleep(100); }
  let scene = "";
  for (const [i, line] of DEMO.lines.entries()) {
    if (line.scene !== scene) console.log(dim(`  — scene ${(scene = line.scene)}`));
    console.log(dim(`    teacher: ${line.say}`));
    const padded = new Uint8Array(audio[i]!.length + 38_400); // 1.2 s pause so each line is committed on its own
    padded.set(audio[i]!);
    for (let o = 0; o < padded.length; o += 3200) { ws.send(padded.subarray(o, o + 3200)); await sleep(100); }
    if (line.say.startsWith("Let me draw")) send({ type: "gaze.transition", transition: { from: "SCREEN", to: "BOARD", targetId: null, ts: Date.now() }, ts: Date.now() });
    if (line.say.includes("complex conjugates")) send({ type: "gaze.transition", transition: { from: "BOARD", to: "SCREEN", targetId: null, ts: Date.now() }, ts: Date.now() });
  }
  await sleep(3000); // let the last line commit before the mic stops
  send({ type: "audio.stop", ts: Date.now() });
  await poll(async () => messages, (m) => {
    const finals = m.filter((x) => x.type === "caption.final").length;
    return finals > 0 && m.filter((x) => x.type === "caption.refined").length >= finals;
  }, 20_000);

  // --- what the student saw ------------------------------------------------------------------------------------------
  console.log(bold("\nWhat the student saw (raw speech-to-text → formatted caption; bold = glossary term, ⟦⟧ = rendered formula)"));
  const refined = new Map(messages.flatMap((m) => (m.type === "caption.refined" ? [[m.segment.id, m] as const] : [])));
  const finals = messages.flatMap((m) => (m.type === "caption.final" ? [m] : []));
  let lastSlide = -1;
  for (const f of finals) {
    const r = refined.get(f.segment.id);
    const pointer = r?.segment.slidePointer;
    const slide = pointer && pointer.slideIndex !== lastSlide ? `  ${green(`→ slide ${pointer.slideIndex + 1}`)}` : "";
    if (pointer) lastSlide = pointer.slideIndex;
    console.log(`  ${dim(`+${((f.ts - audioStart) / 1000).toFixed(1)}s`)} ${dim(f.segment.text)}`);
    console.log(`         ${r ? render(r.segment) : dim("(not refined)")}${slide}`);
  }
  for (const m of messages) if (m.type === "snapshot.request") console.log(`  ${green("📸 snapshot requested")}: ${m.reason}`);
  for (const m of messages) if (m.type === "error") console.log(`  ✘ socket error ${m.code}: ${m.message}`);
  const formulas = [...refined.values()].flatMap((r) => r.segment.parts.filter((p) => p.type === "formula"));
  const terms = [...refined.values()].flatMap((r) => r.segment.corrections.filter((c) => c.reason === "GLOSSARY"));
  console.log(`\n  ${finals.length} caption lines for ${DEMO.lines.length} spoken · ${formulas.length} formulas rendered · ${terms.length} term corrections${terms.length ? ` (${terms.map((c) => `${c.from} → ${c.to}`).join("; ")})` : ""}`);

  // --- the student asks in sign language; a board snapshot ------------------------------------------------------------
  console.log(bold("\nThe student signs a question"));
  t = Date.now();
  const utterance = await json(SignUtterance, `/api/sessions/${session.id}/sign/utterances`, {
    method: "POST",
    body: JSON.stringify({ source: "SELF", speak: true, tokens: DEMO.signedQuestion.map((gloss, i) => ({ id: `tok_${i}`, gloss, kind: "SIGN", confidence: 0.9, ts: Date.now() })) }),
  });
  console.log(`  ${DEMO.signedQuestion.join(" ")} → "${utterance.text}" (${Date.now() - t} ms, ${utterance.audioUrl ? "spoken aloud" : "no audio"})`);
  const page = deck.slides[3]?.imageUrl;
  if (page) {
    const image = await fetch((await http(new URL(page).pathname, { redirect: "manual" })).headers.get("location") ?? "");
    const snapForm = new FormData();
    snapForm.append("file", new File([await image.arrayBuffer()], "board.png", { type: "image/png" }));
    snapForm.append("trigger", "SPEECH_CUE");
    snapForm.append("reason", 'Teacher: "Let me draw the three cases on the board."');
    const snap = await json(Snapshot, `/api/sessions/${session.id}/snapshots`, { method: "POST", body: snapForm });
    const described = await poll(async () => (await json(ListResponse(Snapshot), `/api/sessions/${session.id}/snapshots`)).data.find((s) => s.id === snap.id), (s) => !!s?.description, 30_000);
    console.log(`  board snapshot described: "${described?.description ?? "(no description)"}"`);
  }

  // --- after class ---------------------------------------------------------------------------------------------------
  console.log(bold("\nAfter class — notes"));
  t = Date.now();
  await json(Session, `/api/sessions/${session.id}/end`, { method: "POST" });
  const notes = await poll(() => json(NotesResponse, `/api/sessions/${session.id}/notes`), (n) => n.status === "READY" || n.status === "FAILED", 180_000);
  console.log(`  notes ${notes.status} in ${((Date.now() - t) / 1000).toFixed(1)} s${notes.error ? `: ${notes.error}` : ""}`);
  for (const section of notes.notes?.sections ?? []) {
    const kinds = section.blocks.reduce<Record<string, number>>((a, b) => ({ ...a, [b.type]: (a[b.type] ?? 0) + 1 }), {});
    console.log(`  § ${bold(section.heading)} ${dim(JSON.stringify(kinds))}${section.boardFocus?.isBoardHeavy ? green(` · looked at the board ${section.boardFocus.awaySeconds}s`) : ""}`);
  }
  for (const f of notes.notes?.formulas ?? []) console.log(`    ${green(`⟦${f.latex}⟧`)} ${dim(f.description)}`);
  ws.close();

} catch (error) {
  await http(`/api/sessions/${session.id}`, { method: "DELETE" }).catch(() => {});
  console.error("\nrehearsal failed (session deleted):", error instanceof Error ? error.message : error);
  process.exit(1);
}

if (keep) {
  console.log(bold(`\nKept the session. Log in at ${ORIGIN}/sign-in to look around:`));
  console.log(`  email ${login.email}\n  password ${login.password}`);
} else {
  await http(`/api/sessions/${session.id}`, { method: "DELETE" });
  console.log(dim("\n(session deleted — pass --keep to inspect it in the web app)"));
}
process.exit(0);
