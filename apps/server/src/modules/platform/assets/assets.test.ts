import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { Session } from "@sightline/contracts";
import { MemoryAssetStore, MemoryAssetIndex, ObjectAssetStore } from "./asset-store";
import { LocalObjectStorage } from "../../../lib/storage";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../store/memory-store";
import { platformRoutes } from "../routes";
import { PlatformService } from "../platform-service";
import { MemoryJobs } from "../jobs/memory-jobs";
import { MockKnowledgeEngine } from "../knowledge/mock-knowledge-engine";
import { MockNotesEngine } from "../notes/mock-notes-engine";
import { MockSlideProcessor } from "../slides/slide-processor";
import { errorHandler } from "../../../lib/error-handler";
import { AppError } from "../../../lib/errors";

test("asset HTTP route rejects anonymous and other users and permits owner", async () => {
  const store = new MemoryStore();
  const session: Session = { id: "ses_asset", title: "Private", subject: null, mode: "DEAF", status: "DRAFT", contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY", createdAt: 0, startedAt: null, endedAt: null };
  await store.createSession("owner", session);
  const assets = new MemoryAssetStore(store);
  const id = await assets.put("image/png", new Uint8Array([1, 2]), session.id);
  const platform = new PlatformService({ store, assets, jobs: new MemoryJobs(store), knowledge: new MockKnowledgeEngine(), notes: new MockNotesEngine(), slides: new MockSlideProcessor(assets, (assetId) => assetId), events: { publish() {} }, lifecycle: { async onSessionStarted() {}, async onSessionEnded() {}, async onSessionDeleted() {} } });
  const app = new Elysia().use(errorHandler).use(platformRoutes({ platform, assets, health: () => ({ status: "ok", version: "test", ts: 0, mocks: { captions: true, speech: true, knowledge: true, notes: true, persistence: true, slides: true, auth: false } }), resolveUser: async (request) => {
    const userId = request.headers.get("x-test-user");
    if (!userId) throw new AppError("UNAUTHORIZED", "Sign in required");
    return { id: userId, name: userId, email: `${userId}@test.dev`, isMock: false };
  } }));
  const request = (user?: string) => app.handle(new Request(`http://localhost/api/assets/${id}`, { headers: user ? { "x-test-user": user } : {} }));
  expect((await request()).status).toBe(401);
  expect((await request("other")).status).toBe(404);
  const response = await request("owner");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const snapshot = { id: "snp_export", sessionId: session.id, imageUrl: `http://localhost/api/assets/${id}`, trigger: "MANUAL" as const, reason: "Board", capturedAt: 0, atMs: 0, segmentIds: [], description: null };
  await store.upsertSnapshot(snapshot);
  await store.saveNotes({ id: "nts_export", sessionId: session.id, generatedAt: 0, title: "Board notes", summary: "Summary", sections: [{ id: "sec_board", heading: "Board", blocks: [{ type: "image", snapshotId: snapshot.id, url: snapshot.imageUrl, caption: "Board" }], sourceSegmentIds: [], slideIndexes: [], boardFocus: null }], keyTerms: [], formulas: [], takeaways: [], markdown: `![Board](${snapshot.imageUrl})` });
  const exported = await app.handle(new Request(`http://localhost/api/sessions/${session.id}/notes/export`, { headers: { "x-test-user": "owner" } }));
  expect(exported.status).toBe(200);
  expect(exported.headers.get("cache-control")).toBe("private, no-store");
  expect(await exported.text()).toContain("![Board](data:image/png;base64,AQI=)");
  expect((await store.getNotes(session.id))?.markdown).toContain(snapshot.imageUrl);
  expect((await app.handle(new Request(`http://localhost/api/sessions/${session.id}/notes/export`, { headers: { "x-test-user": "other" } }))).status).toBe(404);
  await store.createSession("other", { ...session, id: "ses_other_asset" });
  const privateId = await assets.put("image/png", new Uint8Array([3]), "ses_other_asset");
  await store.upsertSnapshot({ ...snapshot, imageUrl: `http://localhost/api/assets/${privateId}` });
  const savedNotes = (await store.getNotes(session.id))!;
  await store.saveNotes({ ...savedNotes, sections: savedNotes.sections.map((section) => ({ ...section, blocks: section.blocks.map((block) => block.type === "image" ? { ...block, url: `http://localhost/api/assets/${privateId}` } : block) })) });
  await expect(platform.exportNotesMarkdown("owner", session.id)).rejects.toThrow();
  await store.deleteSession(session.id);
  expect((await request("owner")).status).toBe(404);
  await assets.deleteSession(session.id);
  expect(await assets.get(id)).toBeNull();
});

test("failed object deletion retains ownership metadata for a retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sightline-cleanup-"));
  try {
    const store = new MemoryStore();
    await store.createSession("owner", { id: "ses_cleanup", title: "Private", subject: null, mode: "DEAF", status: "DRAFT", contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY", createdAt: 0, startedAt: null, endedAt: null });
    const storage = new LocalObjectStorage({ dir: directory, publicUrl: "http://test", secret: "s".repeat(32) });
    const assets = new ObjectAssetStore(storage, new MemoryAssetIndex(store));
    const id = await assets.put("image/png", new Uint8Array([1]), "ses_cleanup");
    const remove = storage.deleteObject.bind(storage);
    storage.deleteObject = async () => { throw new Error("Object storage unavailable"); };
    await expect(assets.deleteSession("ses_cleanup")).rejects.toThrow("unavailable");
    expect(await assets.getSessionId(id)).toBe("ses_cleanup");
    storage.deleteObject = remove;
    await assets.deleteSession("ses_cleanup");
    expect(await assets.getSessionId(id)).toBeNull();
    expect(await storage.stat(`assets/ses_cleanup/${id}`)).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
