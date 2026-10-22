import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, type Database } from "@sightline/db";
import { createAuth } from "@sightline/auth";
import { sql } from "drizzle-orm";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { CaptionSegment, Recording, Session, Snapshot } from "@sightline/contracts";
import { PostgresStore } from "./store/postgres-store";
import { PostgresJobs } from "./jobs/postgres-jobs";
import { QdrantKnowledgeEngine } from "./knowledge/qdrant-knowledge-engine";
import { createUserResolver } from "./auth";
import { OpenAIEmbeddings, MastraStructuredModel } from "./ai/structured-model";
import { FileSlideProcessor } from "./slides/slide-processor";
import { MemoryAssetStore, ObjectAssetStore, PostgresAssetIndex } from "./assets/asset-store";
import { LocalObjectStorage } from "../../lib/storage";
import { MemoryStore } from "./store/memory-store";
import { lecturePdf } from "../../../scripts/fixtures";
import { lecturePowerPoint } from "../../../scripts/powerpoint-fixture";
import { Elysia } from "elysia";
import { createLiveModule } from "../live";
import { MockKnowledgeEngine } from "./knowledge/mock-knowledge-engine";
import { MockTts } from "../live/speech/tts";
import { errorHandler } from "../../lib/error-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const qdrantUrl = process.env.TEST_QDRANT_URL;
// Remote databases (e.g. the Coolify Postgres from a laptop) are ~150 ms per round trip.
if (databaseUrl) setDefaultTimeout(60_000);
const session: Session = { id: "ses_integration", title: "Circuits", subject: null, mode: "DEAF", status: "DRAFT", contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY", createdAt: 1, startedAt: null, endedAt: null };

describe.skipIf(!databaseUrl)("real Postgres and better-auth", () => {
  const schema = `sightline_test_${randomUUID().replace(/-/g, "")}`;
  let admin: Database;
  let database: Database;
  let schemaCreated = false;
  beforeAll(async () => {
    admin = createDb({ DATABASE_URL: databaseUrl! });
    await admin.execute(sql.raw(`CREATE SCHEMA "${schema}"`));
    schemaCreated = true;
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    database = createDb({ DATABASE_URL: url.href });
    const directory = new URL("../../../../../packages/db/src/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => /^\d/.test(name)).sort()) {
      const migration = await Bun.file(new URL(`${name}/migration.sql`, directory)).text();
      await database.execute(sql.raw(migration));
      await database.execute(sql.raw(migration));
    }
  });
  afterAll(async () => {
    await database?.$client.end();
    if (admin) {
      if (schemaCreated) await admin.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
      await admin.$client.end();
    }
  });

  test("store survives adapter recreation and preserves ownership and caption status", async () => {
    const store = new PostgresStore(database);
    await store.provisionDemoUser();
    await store.createSession("usr_demo", session);
    const segment: CaptionSegment = { id: "seg_integration", sessionId: session.id, seq: 0, startMs: 0, endMs: 1000, status: "REFINED", text: "Kirchhoff", rawText: "kerchief", parts: [], corrections: [], confidence: 1, speaker: null, slidePointer: null };
    await store.upsertSegment(segment);
    await store.upsertSegment({ ...segment, status: "FINAL", text: "kerchief" });
    const fresh = new PostgresStore(database);
    expect((await fresh.listSegments(session.id))[0]?.text).toBe("Kirchhoff");
    expect(await fresh.getSession("other", session.id)).toBeNull();
    expect((await fresh.getContext(session.id)).status).toBe("EMPTY");
  });

  test("snapshots persist with stable ordering, updates, isolation and cascade deletion", async () => {
    const store = new PostgresStore(database);
    const sessionId = "ses_snapshot_db";
    await store.createSession("usr_demo", { ...session, id: sessionId });
    await store.createSession("usr_demo", { ...session, id: "ses_snapshot_other" });
    const snapshot: Snapshot = { id: "snp_b", sessionId, imageUrl: "http://test/api/assets/ast_board", trigger: "MANUAL", reason: "board", capturedAt: 10, atMs: 0, segmentIds: ["seg_a"], description: null };
    await store.upsertSnapshot(snapshot);
    await store.upsertSnapshot({ ...snapshot, id: "snp_a" });
    await store.upsertSnapshot({ ...snapshot, description: "updated" });
    await store.upsertSnapshot({ ...snapshot, sessionId: "ses_snapshot_other", reason: "wrong session" });
    const fresh = new PostgresStore(database);
    expect((await fresh.listSnapshots(sessionId)).map((item) => item.id)).toEqual(["snp_a", "snp_b"]);
    expect((await fresh.listSnapshots(sessionId))[1]?.description).toBe("updated");
    expect(await fresh.listSnapshots("ses_snapshot_other")).toEqual([]);
    await fresh.deleteSession(sessionId);
    expect(await fresh.listSnapshots(sessionId)).toEqual([]);
    await expect(fresh.upsertSnapshot(snapshot)).rejects.toThrow();
  });

  test("recordings survive restart without signed URLs and remain session scoped", async () => {
    const store = new PostgresStore(database);
    const sessionId = "ses_recording_db";
    await store.createSession("usr_demo", { ...session, id: sessionId });
    const recording: Recording = { id: "rec_b", sessionId, source: "SCREEN", status: "RECORDING", startedAt: 10, endedAt: null, durationMs: 0,
      segments: [{ index: 0, contentType: "video/webm", status: "UPLOADED", sizeBytes: 100, startMs: 0, durationMs: 1000, url: "https://secret.example/signed" }] };
    await store.upsertRecording(recording);
    await store.upsertRecording({ ...recording, id: "rec_a" });
    await store.upsertRecording({ ...recording, status: "READY", endedAt: 1000, durationMs: 1000 });
    await store.upsertRecording({ ...recording, sessionId: "ses_snapshot_other", status: "FAILED" });
    const fresh = new PostgresStore(database);
    expect((await fresh.listRecordings(sessionId)).map((item) => item.id)).toEqual(["rec_a", "rec_b"]);
    expect((await fresh.getRecording(sessionId, "rec_b"))?.status).toBe("READY");
    expect((await fresh.getRecording(sessionId, "rec_b"))?.segments[0]?.url).toBeNull();
    expect(await fresh.getRecording("ses_snapshot_other", "rec_b")).toBeNull();
    const stored = await database.execute(sql`SELECT segments FROM recording WHERE id = 'rec_b'`);
    expect(JSON.stringify(stored.rows)).not.toContain("secret.example");
    await new PostgresJobs(database).deleteSession(sessionId, 60_000);
    const recoveredJobs = new PostgresJobs(database);
    const cleanup = (await recoveredJobs.claim(Date.now()))!;
    expect(cleanup.payload.recordingKeys).toEqual(["recordings/ses_recording_db/rec_a/segment-0000.webm", "recordings/ses_recording_db/rec_b/segment-0000.webm"]);
    expect(cleanup.payload.recordingCleanupAfter).toBeGreaterThan(Date.now());
    await recoveredJobs.complete(cleanup, { next: { kind: "CLEANUP", payload: { recordingKeys: cleanup.payload.recordingKeys }, availableAt: cleanup.payload.recordingCleanupAfter } });
    expect(await new PostgresJobs(database).claim(Date.now())).toBeNull();
    const finalCleanup = (await new PostgresJobs(database).claim(Date.now() + 65_000))!;
    expect(finalCleanup.payload.recordingKeys).toEqual(cleanup.payload.recordingKeys);
    await recoveredJobs.complete(finalCleanup);
    expect(await fresh.listRecordings(sessionId)).toEqual([]);
    expect(await fresh.getRecording(sessionId, "rec_b")).toBeNull();
    await expect(fresh.upsertRecording(recording)).rejects.toThrow();
  });

  test("separate repositories coordinate claims, revisions and deletion", async () => {
    const store = new PostgresStore(database);
    const first = new PostgresJobs(database);
    const second = new PostgresJobs(database);
    await first.enqueue(session.id, "NOTES", {}, { session: { notesStatus: "PROCESSING" } });
    const claims = await Promise.all([first.claim(Date.now()), second.claim(Date.now())]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = claims.find((claim) => claim)!;
    expect(await second.complete(job, { session: { notesStatus: "READY" } })).toBe(true);
    await first.deleteSession(session.id);
    expect(await store.findSession(session.id)).toBeNull();
    const cleanup = (await second.claim(Date.now()))!;
    expect(cleanup.kind).toBe("CLEANUP");
    await second.complete(cleanup);
    expect((await store.listSegments(session.id)).length).toBe(0);
  });

  test("a connection stuck in a transaction never stalls other instances' claims", async () => {
    const store = new PostgresStore(database);
    for (const id of ["ses_claim_a", "ses_claim_b"]) {
      await store.createSession("usr_demo", { ...session, id });
      await new PostgresJobs(database).enqueue(id, "NOTES");
    }
    // An orphaned client (killed process behind a TCP proxy) still holding session A's lock. (Claims no longer take
    // a global lock at all, so an orphan holding the old one — 913481 — can't block them either.)
    const stuck = await database.$client.connect();
    await stuck.query("begin");
    await stuck.query("select pg_advisory_xact_lock(hashtextextended('ses_claim_a', 0))");
    try {
      const claimed: string[] = [];
      const started = Date.now();
      for (let i = 0; i < 5; i++) {
        const job = await Promise.race([new PostgresJobs(database).claim(Date.now()), Bun.sleep(5000).then(() => "timeout" as const)]);
        expect(job).not.toBe("timeout");
        if (!job || job === "timeout") break;
        claimed.push(job.sessionId);
      }
      expect(claimed).toContain("ses_claim_b");
      expect(claimed).not.toContain("ses_claim_a");
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await stuck.query("rollback");
      stuck.release();
    }
    expect((await new PostgresJobs(database).claim(Date.now()))?.sessionId).toBe("ses_claim_a");
    // Leave nothing claimable behind for the tests that follow (they claim with a clock minutes ahead).
    await database.execute(sql`delete from platform_work where key like 'ses_claim_%'`);
    await database.execute(sql`delete from platform_job where session_id in ('ses_claim_a', 'ses_claim_b')`);
    await database.execute(sql`delete from lecture_session where id in ('ses_claim_a', 'ses_claim_b')`);
  });

  test("recording writes wait for the session deletion lock", async () => {
    const store = new PostgresStore(database);
    await store.createSession("usr_demo", { ...session, id: "ses_recording_lock" });
    let writing: Promise<void> | undefined;
    let written = false;
    try {
      await database.transaction(async (transaction) => {
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('ses_recording_lock', 0))`);
        writing = store.upsertRecording({ id: "rec_locked", sessionId: "ses_recording_lock", source: "SCREEN", status: "RECORDING", startedAt: 0, endedAt: null, durationMs: 0, segments: [] }).then(() => { written = true; });
        await Bun.sleep(100);
        expect(written).toBe(false);
      });
    } finally { await writing; }
    expect(written).toBe(true);
    await store.deleteSession("ses_recording_lock");
  });

  test("object-storage assets survive recreation; ownership lives in Postgres; cleanup deletes objects", async () => {
    const store = new PostgresStore(database);
    const sessionId = "ses_disk";
    await store.createSession("usr_demo", { ...session, id: sessionId });
    const directory = await mkdtemp(join(tmpdir(), "sightline-asset-test-"));
    try {
      const storage = new LocalObjectStorage({ dir: directory, publicUrl: "http://test", secret: "s".repeat(32) });
      const assets = new ObjectAssetStore(storage, new PostgresAssetIndex(database));
      const id = await assets.put("image/png", new Uint8Array([1, 2, 3]), sessionId);
      const fresh = new ObjectAssetStore(storage, new PostgresAssetIndex(database));
      expect((await fresh.get(id))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
      expect(await fresh.getSessionId(id)).toBe(sessionId);
      await fresh.deleteSession(sessionId);
      expect(await fresh.get(id)).toBeNull();
      expect(await storage.stat(`assets/${sessionId}/${id}`)).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("database publication lock orders deletion and retry recovery stops at three", async () => {
    const store = new PostgresStore(database);
    const sessionId = "ses_db_recovery";
    await store.createSession("usr_demo", { ...session, id: sessionId });
    const jobs = new PostgresJobs(database);
    await jobs.enqueue(sessionId, "NOTES", {}, { session: { notesStatus: "PROCESSING" } });
    const now = Date.now();
    expect((await jobs.claim(now))?.attempts).toBe(1);
    expect((await jobs.claim(now + 61_000))?.attempts).toBe(2);
    expect((await jobs.claim(now + 122_000))?.attempts).toBe(3);
    expect(await jobs.claim(now + 183_000)).toBeNull();
    expect((await store.findSession(sessionId))?.notesStatus).toBe("FAILED");
    await jobs.enqueue(sessionId, "CONTEXT");
    const claimed = (await jobs.claim(Date.now()))!;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((done) => { entered = done; });
    const gate = new Promise<void>((done) => { release = done; });
    const order: string[] = [];
    const publishing = jobs.publish(claimed, async () => { entered(); await gate; order.push("published"); });
    await started;
    const deleting = jobs.deleteSession(sessionId).then(() => { order.push("deleted"); });
    release();
    await Promise.all([publishing, deleting]);
    expect(order).toEqual(["published", "deleted"]);
  });

  test("two users register and sign in with isolated cookies; logout revokes access", async () => {
    const auth = createAuth({ BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "integration-only-secret-with-32-characters", CORS_ORIGIN: "http://localhost:3001" }, database);
    const resolve = createUserResolver({ mock: false, auth });
    const request = async (path: string, body: unknown, cookie?: string) => auth.handler(new Request(`http://localhost:3000/api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3001", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
    const signup = async (name: string) => {
      const response = await request("sign-up/email", { name, email: `${name}@test.dev`, password: "test-password-for-integration" });
      expect(response.status).toBe(200);
      return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    };
    const cookieA = await signup("student-a");
    const cookieB = await signup("student-b");
    const userA = await resolve(new Request("http://localhost/api/me", { headers: { cookie: cookieA } }));
    const userB = await resolve(new Request("http://localhost/api/me", { headers: { cookie: cookieB } }));
    expect(userA.id).not.toBe(userB.id);
    const store = new PostgresStore(database);
    await store.createSession(userA.id, { ...session, id: "ses_private" });
    expect(await store.getSession(userB.id, "ses_private")).toBeNull();
    const live = createLiveModule({ store, assets: new MemoryAssetStore(store), knowledge: new MockKnowledgeEngine(), resolveUser: resolve, captions: { mock: true }, tts: new MockTts(), stt: { name: "unused", isReplay: false, open: () => ({ push() {}, async close() {} }) }, assetUrl: (id) => id });
    const app = new Elysia().use(errorHandler).use(live.socket).listen(0);
    const connect = (cookie: string) => new Promise<boolean>((done) => {
      const socket = new WebSocket(`ws://localhost:${app.server!.port}/ws/sessions/ses_private`, { headers: { cookie } });
      let accepted = false;
      const timer = setTimeout(() => { socket.close(); done(false); }, 5000);
      socket.onmessage = (event) => { accepted = JSON.parse(String(event.data)).type === "session.ready"; socket.close(); };
      socket.onclose = () => { clearTimeout(timer); done(accepted); };
      socket.onerror = () => { socket.close(); };
    });
    try {
      expect(await connect(cookieA)).toBe(true);
      expect(await connect(cookieB)).toBe(false);
      expect((await request("sign-in/email", { email: "student-a@test.dev", password: "test-password-for-integration" })).status).toBe(200);
      expect((await request("sign-out", {}, cookieA)).status).toBe(200);
      const revoked = await auth.handler(new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie: cookieA } }));
      expect(revoked.status).toBe(200);
      expect(await revoked.json()).toBeNull();
      let rejection: unknown;
      try { await resolve(new Request("http://localhost/api/me", { headers: { cookie: cookieA } })); } catch (error) { rejection = error; }
      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toBe("Sign in required");
    } finally { await app.stop(true); }
  }, 30_000);
});

test.skipIf(!qdrantUrl)("real Qdrant ingest/retrieve/replacement/isolation/deletion", async () => {
  const client = new QdrantClient({ url: qdrantUrl!, port: Number(new URL(qdrantUrl!).port) || null, apiKey: process.env.TEST_QDRANT_API_KEY || undefined, checkCompatibility: false });
  // Throwaway collection: the fake 3-dim embeddings must never touch the real (768-dim) shared collection.
  const collection = `test_context_${randomUUID().replace(/-/g, "")}`;
  const knowledge = new QdrantKnowledgeEngine({ client, collection, embeddings: { embed: async (texts) => texts.map((text) => /voltage/i.test(text) ? [0, 1, 0] : [1, 0, 0]) }, model: { generate: async (schema) => schema.parse({ glossary: [], topics: ["Circuits"] }) } });
  const sessionId = `ses_${randomUUID().replace(/-/g, "")}`;
  try {
    await knowledge.ingestContext({ sessionId, title: "Circuits", subject: null, text: "Current is conserved", slides: [] });
    expect((await knowledge.retrieveContext({ sessionId, query: "current", limit: 5 }))[0]?.text).toBe("Current is conserved");
    expect(await knowledge.retrieveContext({ sessionId: `${sessionId}other`, query: "current", limit: 5 })).toEqual([]);
    await knowledge.ingestContext({ sessionId, title: "Circuits", subject: null, text: "Voltage is conserved", slides: [] });
    expect((await knowledge.retrieveContext({ sessionId, query: "voltage", limit: 5 })).map((chunk) => chunk.text)).toEqual(["Voltage is conserved"]);
    await knowledge.dropSession(sessionId);
    expect(await knowledge.retrieveContext({ sessionId, query: "current", limit: 5 })).toEqual([]);
  } finally { await client.deleteCollection(collection).catch(() => {}); }
}, 60_000);

test.skipIf(!process.env.TEST_REAL_CONVERTERS && !process.env.TEST_PDF_CONVERTERS)("real PDF conversion produces private page images and text", async () => {
  const store = new MemoryStore();
  await store.createSession("user", session);
  const assets = new MemoryAssetStore(store);
  const processor = new FileSlideProcessor(assets, (id) => `http://localhost/api/assets/${id}`);
  const slides = await processor.process({ sessionId: session.id, fileName: "lecture.pdf", bytes: lecturePdf() });
  expect(slides).toHaveLength(1);
  expect(slides[0]?.text).toContain("Kirchhoff");
  expect(slides[0]?.index).toBe(0);
}, 120_000);

test.skipIf(!process.env.TEST_REAL_CONVERTERS)("real PPTX and legacy PPT conversion preserve page text", async () => {
  const store = new MemoryStore();
  await store.createSession("user", session);
  const assets = new MemoryAssetStore(store);
  const processor = new FileSlideProcessor(assets, (id) => `http://localhost/api/assets/${id}`);
  const bytes = lecturePowerPoint();
  const slides = await processor.process({ sessionId: session.id, fileName: "lecture.pptx", bytes });
  expect(slides[0]?.text).toContain("Kirchhoff");
  const directory = await mkdtemp(join(tmpdir(), "sightline-ppt-test-"));
  try {
    const source = join(directory, "lecture.pptx");
    await Bun.write(source, bytes);
    const converter = Bun.spawn(["libreoffice", `-env:UserInstallation=${pathToFileURL(join(directory, "profile")).href}`, "--headless", "--convert-to", "ppt:MS PowerPoint 97", "--outdir", directory, source], { stdout: "ignore", stderr: "ignore", timeout: 120_000 });
    expect(await converter.exited).toBe(0);
    const legacy = await processor.process({ sessionId: session.id, fileName: "lecture.ppt", bytes: new Uint8Array(await Bun.file(join(directory, "lecture.ppt")).arrayBuffer()) });
    expect(legacy[0]?.text).toContain("Kirchhoff");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 300_000);

test.skipIf(!process.env.TEST_PROVIDER || !process.env.GEMINI_API_KEY || !process.env.MERGE_GATEWAY_API_KEY)("credentialed provider embeddings and structured glossary", async () => {
  const embeddings = new OpenAIEmbeddings(process.env.GEMINI_API_KEY, process.env.EMBEDDING_MODEL ?? "gemini-embedding-001", {
    baseURL: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
    dimensions: 768,
  });
  expect((await embeddings.embed(["Kirchhoff current law"]))[0]?.length).toBeGreaterThan(0);
  const model = new MastraStructuredModel(
    { url: process.env.LLM_GATEWAY_URL ?? "https://api-gateway.merge.dev/v1/openai", apiKey: process.env.MERGE_GATEWAY_API_KEY },
    process.env.LLM_MODEL ?? "zai/glm-5.3-flash",
  );
  const { z } = await import("zod");
  const result = await model.generate(z.object({ term: z.string() }), "Extract the named law from the source.", { source: "Kirchhoff current law" });
  expect(result.term.toLowerCase()).toContain("kirchhoff");
}, 60_000);
