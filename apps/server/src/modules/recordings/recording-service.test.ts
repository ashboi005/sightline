import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalObjectStorage } from "../../lib/storage";
import { MemoryStore } from "../platform/store/memory-store";
import { RecordingService, segmentKey } from "./recording-service";

describe("RecordingService", () => {
  let dir = "";
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("create → reserve (presigned PUT) → upload → complete → finish → list with playback URLs", async () => {
    dir = await mkdtemp(join(tmpdir(), "sightline-rec-"));
    const storage = new LocalObjectStorage({ dir, publicUrl: "http://api.test", secret: "k".repeat(32) });
    const store = new MemoryStore();
    await store.createSession("usr", {
      id: "ses_1", title: "t", subject: null, mode: "DEAF", status: "LIVE",
      contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY",
      createdAt: 0, startedAt: Date.now(), endedAt: null,
    });
    const svc = new RecordingService({ store, storage, urlTtlSeconds: 600 });

    const rec = await svc.create("ses_1", { source: "SCENE_CAMERA", contentType: "video/webm" });
    expect(rec.status).toBe("RECORDING");
    const { upload } = await svc.reserveSegment("ses_1", rec.id, { index: 0, contentType: "video/webm", sizeBytes: 4, startMs: 0, durationMs: 300_000 });
    expect(upload.url).toStartWith("http://api.test/api/storage/upload/");

    await expect(svc.completeSegment("ses_1", rec.id, 0)).rejects.toMatchObject({ code: "CONFLICT" }); // not uploaded yet
    await storage.putObject(segmentKey("ses_1", rec.id, 0, "video/webm"), new Uint8Array([1, 2, 3, 4]), "video/webm");
    const seg = await svc.completeSegment("ses_1", rec.id, 0);
    expect(seg).toMatchObject({ status: "UPLOADED", sizeBytes: 4 });
    expect(seg.url).toStartWith("http://api.test/api/storage/object/");
    await expect(
      svc.reserveSegment("ses_1", rec.id, { index: 0, contentType: "video/webm", sizeBytes: 4, startMs: 0, durationMs: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const done = await svc.finish("ses_1", rec.id);
    expect(done).toMatchObject({ status: "READY", durationMs: 300_000 });
    const [listed] = await svc.list("ses_1");
    expect(listed!.segments[0]!.url).toStartWith("http://api.test/api/storage/object/");
  });

  it("finishing with nothing uploaded marks the recording FAILED", async () => {
    const storage = new LocalObjectStorage({ dir: await mkdtemp(join(tmpdir(), "sightline-rec-")), publicUrl: "http://x", secret: "k".repeat(32) });
    const store = new MemoryStore();
    await store.createSession("usr", {
      id: "ses_2", title: "t", subject: null, mode: "DEAF", status: "LIVE",
      contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY",
      createdAt: 0, startedAt: 1, endedAt: null,
    });
    const svc = new RecordingService({ store, storage, urlTtlSeconds: 60 });
    const rec = await svc.create("ses_2", { source: "WEBCAM", contentType: "video/webm" });
    expect((await svc.finish("ses_2", rec.id)).status).toBe("FAILED");
  });
});
