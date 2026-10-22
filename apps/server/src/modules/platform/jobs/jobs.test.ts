import { expect, spyOn, test } from "bun:test";
import type { Session } from "@sightline/contracts";
import { MemoryStore } from "../store/memory-store";
import { MemoryJobs } from "./memory-jobs";

const session: Session = { id: "ses_jobs", title: "Test", mode: "DEAF", subject: null, status: "ENDED", contextStatus: "EMPTY", notesStatus: "EMPTY", slidesStatus: "EMPTY", createdAt: 0, startedAt: 0, endedAt: 1000 };

test("jobs coalesce notes, fence stale results and recover expired leases", async () => {
  const store = new MemoryStore();
  await store.createSession("user", session);
  const jobs = new MemoryJobs(store);
  const first = await jobs.enqueue(session.id, "NOTES", {}, { session: { notesStatus: "PROCESSING" } });
  expect((await jobs.enqueue(session.id, "NOTES")).id).toBe(first.id);
  const claimed = (await jobs.claim(Date.now()))!;
  expect(await jobs.claim(Date.now())).toBeNull();
  const reclaimed = (await jobs.claim(Date.now() + 61_000))!;
  expect(reclaimed.id).toBe(claimed.id);
  expect(reclaimed.token).not.toBe(claimed.token);
  expect(await jobs.complete(claimed, { session: { notesStatus: "READY" } })).toBe(false);
  expect(await jobs.complete(reclaimed, { session: { notesStatus: "READY" } })).toBe(true);
});

test("superseded jobs and deleted sessions cannot publish", async () => {
  const store = new MemoryStore();
  await store.createSession("user", session);
  const jobs = new MemoryJobs(store);
  await jobs.enqueue(session.id, "CONTEXT");
  const stale = (await jobs.claim(Date.now()))!;
  await jobs.enqueue(session.id, "CONTEXT");
  expect(await jobs.complete(stale)).toBe(false);
  await jobs.deleteSession(session.id);
  const cleanup = (await jobs.claim(Date.now()))!;
  expect(cleanup.kind).toBe("CLEANUP");
  expect(await store.findSession(session.id)).toBeNull();
});

test("repeated worker interruptions stop after three attempts and expose failure", async () => {
  const store = new MemoryStore();
  await store.createSession("user", session);
  const jobs = new MemoryJobs(store);
  await jobs.enqueue(session.id, "NOTES", {}, { session: { notesStatus: "PROCESSING" } });
  const now = Date.now();
  expect((await jobs.claim(now))?.attempts).toBe(1);
  expect((await jobs.claim(now + 61_000))?.attempts).toBe(2);
  expect((await jobs.claim(now + 122_000))?.attempts).toBe(3);
  expect(await jobs.claim(now + 183_000)).toBeNull();
  expect((await store.findSession(session.id))?.notesStatus).toBe("FAILED");
  expect(await store.getNotesError(session.id)).toContain("interrupted");
});

test("external publication and deletion are ordered under the same lock", async () => {
  const store = new MemoryStore();
  await store.createSession("user", session);
  const jobs = new MemoryJobs(store);
  await jobs.enqueue(session.id, "CONTEXT");
  const job = (await jobs.claim(Date.now()))!;
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const publishing = jobs.publish(job, async () => { events.push("publishing"); await gate; events.push("published"); });
  await Promise.resolve();
  const deleting = jobs.deleteSession(session.id).then(() => { events.push("deleted"); });
  release();
  await Promise.all([publishing, deleting]);
  expect(events).toEqual(["publishing", "published", "deleted"]);
  expect(await jobs.publish(job, async () => { events.push("resurrected"); })).toBe(false);
});

test("completion after lease expiry leaves current work reclaimable", async () => {
  const store = new MemoryStore();
  await store.createSession("user", session);
  const jobs = new MemoryJobs(store);
  await jobs.enqueue(session.id, "NOTES");
  const now = Date.now();
  const job = (await jobs.claim(now))!;
  const clock = spyOn(Date, "now").mockReturnValue(now + 61_000);
  try {
    expect(await jobs.complete(job)).toBe(false);
    expect((await jobs.claim(Date.now()))?.attempts).toBe(2);
  } finally { clock.mockRestore(); }
});
