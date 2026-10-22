import { expect, test } from "bun:test";
import { FileSlideProcessor } from "./slide-processor";
import { MemoryStore } from "../store/memory-store";
import { MemoryAssetStore } from "../assets/asset-store";
import { lecturePdf } from "../../../../scripts/fixtures";
import { MemoryJobs } from "../jobs/memory-jobs";
import { PlatformService } from "../platform-service";
import { MockKnowledgeEngine } from "../knowledge/mock-knowledge-engine";
import { MockNotesEngine } from "../notes/mock-notes-engine";

test("missing converters fail just the upload with an actionable terminal error", async () => {
  const store = new MemoryStore();
  const session = { id: "ses_missing_converter", title: "Slides", subject: null, mode: "DEAF" as const, status: "DRAFT" as const, contextStatus: "EMPTY" as const, slidesStatus: "EMPTY" as const, notesStatus: "EMPTY" as const, createdAt: 0, startedAt: null, endedAt: null };
  await store.createSession("owner", session);
  const assets = new MemoryAssetStore(store);
  const jobs = new MemoryJobs(store);
  const service = new PlatformService({ store, assets, jobs, knowledge: new MockKnowledgeEngine(), notes: new MockNotesEngine(), slides: new FileSlideProcessor(assets, (id) => id, () => null), events: { publish() {} }, lifecycle: { async onSessionStarted() {}, async onSessionEnded() {}, async onSessionDeleted() {} } });
  await service.uploadSlides("owner", session.id, new File([lecturePdf()], "lecture.pdf", { type: "application/pdf" }));
  await service.executeJob((await jobs.claim(Date.now()))!);
  const deck = await service.getSlides("owner", session.id);
  expect(deck.status).toBe("FAILED");
  expect(deck.error).toContain("development server container");
  expect(await jobs.claim(Date.now() + 1_000_000)).toBeNull();
  expect((await service.requireSession("owner", session.id)).status).toBe("DRAFT");
});
