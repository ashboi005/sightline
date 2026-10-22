import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { Session } from "@sightline/contracts";
import { MemoryAssetStore } from "./asset-store";
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
  await store.deleteSession(session.id);
  expect((await request("owner")).status).toBe(404);
  await assets.deleteSession(session.id);
  expect(await assets.get(id)).toBeNull();
});
