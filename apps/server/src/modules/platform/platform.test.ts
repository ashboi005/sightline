import { describe, expect, test } from "bun:test";
import type { CaptionSegment, Session } from "@sightline/contracts";
import { MemoryAssetStore } from "./assets/asset-store";
import { PlatformService } from "./platform-service";
import { MemoryJobs } from "./jobs/memory-jobs";
import { MockKnowledgeEngine } from "./knowledge/mock-knowledge-engine";
import { AppError } from "../../lib/errors";
import { LocalObjectStorage } from "../../lib/storage";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore } from "./store/memory-store";
import { deriveAwayWindows } from "./notes/away-windows";

const session: Session = {
  id: "ses_test", title: "Circuits", subject: null, mode: "DEAF", status: "DRAFT",
  contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY", createdAt: 1000,
  startedAt: null, endedAt: null,
};
const segment: CaptionSegment = {
  id: "seg_test", sessionId: session.id, seq: 0, status: "REFINED", startMs: 0, endMs: 1000,
  speaker: null, rawText: "kerchief", text: "Kirchhoff", parts: [], corrections: [], slidePointer: null, confidence: 1,
};

describe("session persistence invariants", () => {
  test("late finals cannot downgrade refined captions", async () => {
    const store = new MemoryStore();
    await store.createSession("user_a", session);
    await store.upsertSegment(segment);
    await store.upsertSegment({ ...segment, status: "FINAL", text: "kerchief" });
    expect((await store.listSegments(session.id))[0]?.text).toBe("Kirchhoff");
    expect(await store.getSession("user_b", session.id)).toBeNull();
  });

  test("equal timestamps have deterministic pagination", async () => {
    const store = new MemoryStore();
    await store.createSession("user_a", { ...session, id: "ses_a" });
    await store.createSession("user_a", { ...session, id: "ses_b" });
    expect((await store.listSessions("user_a", 1, 1)).items[0]?.id).toBe("ses_b");
  });
});

test("away windows split changing zones and clamp to lecture boundaries", () => {
  const windows = deriveAwayWindows([
    { from: "SCREEN", to: "PERSON", ts: 500, targetId: null },
    { from: "PERSON", to: "BOARD", ts: 1200, targetId: null },
    { from: "BOARD", to: "UNKNOWN", ts: 1400, targetId: null },
    { from: "UNKNOWN", to: "AWAY", ts: 1600, targetId: null },
    { from: "AWAY", to: "SCREEN", ts: 3000, targetId: null },
  ], [segment], 1000, 2000);
  expect(windows.map(({ zone, startedAt, endedAt }) => ({ zone, startedAt, endedAt }))).toEqual([
    { zone: "PERSON", startedAt: 1000, endedAt: 1200 },
    { zone: "BOARD", startedAt: 1200, endedAt: 1600 },
    { zone: "AWAY", startedAt: 1600, endedAt: 2000 },
  ]);
});

test("failed regeneration preserves old notes and exposes a durable error", async () => {
  const store = new MemoryStore();
  await store.createSession("owner", { ...session, status: "ENDED", endedAt: 2000 });
  await store.saveNotes({ id: "nts_old", sessionId: session.id, generatedAt: 1, title: "Old notes", summary: "Prior useful notes", sections: [], keyTerms: [], formulas: [], takeaways: [], markdown: "# Old notes\n" });
  const jobs = new MemoryJobs(store);
  const service = new PlatformService({ store, jobs, assets: new MemoryAssetStore(store), knowledge: new MockKnowledgeEngine(), notes: { name: "failing", async generateNotes() { throw new AppError("VALIDATION_ERROR", "No speech was captured"); } }, slides: { name: "unused", async process() { return []; } }, events: { publish() {} }, lifecycle: { async onSessionStarted() {}, async onSessionEnded() {}, async onSessionDeleted() {} } });
  const processing = await service.regenerateNotes("owner", session.id);
  expect(processing.status).toBe("PROCESSING");
  expect(processing.notes?.id).toBe("nts_old");
  await service.executeJob((await jobs.claim(Date.now()))!);
  const failed = await service.getNotes("owner", session.id);
  expect(failed.status).toBe("FAILED");
  expect(failed.error).toContain("No speech");
  expect(failed.notes?.id).toBe("nts_old");
  expect(await service.exportNotesMarkdown("owner", session.id)).toBe("# Old notes\n");
});

test("recording object cleanup survives metadata deletion and retries storage outages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sightline-recording-cleanup-"));
  try {
    const store = new MemoryStore();
    await store.createSession("owner", session);
    const storage = new LocalObjectStorage({ dir: directory, publicUrl: "http://test", secret: "s".repeat(32) });
    const key = "recordings/ses_test/rec_cleanup/segment-0000.webm";
    await storage.putObject(key, new Uint8Array([1]), "video/webm");
    await store.upsertRecording({ id: "rec_cleanup", sessionId: session.id, source: "SCREEN", status: "READY", startedAt: 0, endedAt: 1000, durationMs: 1000,
      segments: [{ index: 0, contentType: "video/webm", status: "UPLOADED", startMs: 0, durationMs: 1000, sizeBytes: 1, url: null }] });
    const jobs = new MemoryJobs(store);
    const service = new PlatformService({ store, jobs, storage, recordingCleanupDelayMs: 60_000, assets: new MemoryAssetStore(store), knowledge: new MockKnowledgeEngine(), notes: { name: "unused", async generateNotes() { throw new Error("unused"); } }, slides: { name: "unused", async process() { return []; } }, events: { publish() {} }, lifecycle: { async onSessionStarted() {}, async onSessionEnded() {}, async onSessionDeleted() {} } });
    await service.deleteSession("owner", session.id);
    expect(await store.findSession(session.id)).toBeNull();
    const job = (await jobs.claim(Date.now()))!;
    expect(job.payload.recordingKeys).toEqual([key]);
    const remove = storage.deleteObject.bind(storage);
    storage.deleteObject = async () => { throw new Error("Temporary object storage outage"); };
    await service.executeJob(job);
    expect(await storage.stat(key)).not.toBeNull();
    storage.deleteObject = remove;
    await service.executeJob((await jobs.claim(Date.now() + 5000))!);
    expect(await storage.stat(key)).toBeNull();
    expect(await jobs.claim(Date.now() + 5000)).toBeNull();
    await storage.putObject(key, new Uint8Array([2]), "video/webm");
    const finalPass = await jobs.claim(Date.now() + 65_000);
    expect(finalPass?.payload.recordingKeys).toEqual([key]);
    await service.executeJob(finalPass!);
    expect(await storage.stat(key)).toBeNull();
    expect(await jobs.claim(Date.now() + 130_000)).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
