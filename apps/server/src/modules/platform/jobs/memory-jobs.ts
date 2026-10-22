import { newId } from "../../../lib/ids";
import type { SessionStore } from "../store/types";
import type { JobChange, JobKind, JobPayload, JobRepository, PlatformJob } from "./types";
import { recordingCleanup } from "./recording-cleanup";

export async function applyChange(store: SessionStore, sessionId: string, change: JobChange = {}) {
  if (change.session) await store.updateSession(sessionId, change.session);
  if (change.context) await store.saveContext(change.context);
  if (change.deck) await store.saveSlideDeck(change.deck);
  if (change.notes) await store.saveNotes(change.notes);
  if (change.notesError !== undefined) await store.setNotesError(sessionId, change.notesError);
}

export async function failureChange(store: SessionStore, job: PlatformJob, error: string): Promise<JobChange> {
  if (!(await store.findSession(job.sessionId))) return {};
  if (job.kind === "NOTES") return { session: { notesStatus: "FAILED" }, notesError: error };
  if (job.kind === "CONTEXT") return { session: { contextStatus: "FAILED" }, context: { ...await store.getContext(job.sessionId), status: "FAILED", error } };
  if (job.kind === "SLIDES") {
    const deck = await store.getSlideDeck(job.sessionId);
    return deck ? { session: { slidesStatus: "FAILED" }, deck: { ...deck, status: "FAILED", error } } : {};
  }
  return {};
}

export class MemoryJobs implements JobRepository {
  private readonly jobs = new Map<string, PlatformJob>();
  private readonly current = new Map<string, string>();
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: SessionStore) {}

  private locked<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.serial.then(work);
    this.serial = result.catch(() => {});
    return result;
  }

  enqueue(sessionId: string, kind: JobKind, payload: JobPayload = {}, change: JobChange = {}) {
    return this.locked(() => this.schedule(sessionId, kind, payload, change));
  }

  private async schedule(sessionId: string, kind: JobKind, payload: JobPayload = {}, change: JobChange = {}, availableAt?: number) {
      const key = `${sessionId}:${kind}`;
      const previous = this.jobs.get(this.current.get(key) ?? "");
      if (kind === "NOTES" && previous && ["PENDING", "RUNNING"].includes(previous.status)) return { ...previous };
      if (kind !== "CLEANUP" && !(await this.store.findSession(sessionId))) throw new Error("Session no longer exists");
      if (kind === "CONTEXT") change = { ...change, context: { ...(change.context ?? await this.store.getContext(sessionId)), status: "PROCESSING", error: null }, session: { ...change.session, contextStatus: "PROCESSING" } };
      await applyChange(this.store, sessionId, change);
      if (previous?.status === "PENDING") previous.status = "CANCELLED";
      const now = Date.now();
      const job: PlatformJob = { id: newId("job"), sessionId, kind, payload, status: "PENDING", attempts: 0, availableAt: availableAt ?? now, createdAt: now, leaseUntil: null, token: null, error: null };
      this.jobs.set(job.id, job);
      this.current.set(key, job.id);
      return { ...job };
  }

  claim(now: number) {
    return this.locked(async () => {
      for (const job of this.jobs.values()) {
        if (job.status === "RUNNING" && (job.leaseUntil ?? 0) <= now) {
          const current = this.current.get(`${job.sessionId}:${job.kind}`) === job.id;
          job.status = !current ? "CANCELLED" : job.attempts >= 3 ? "FAILED" : "PENDING";
          if (job.status === "FAILED") {
            job.error = "Processing was interrupted too many times";
            await applyChange(this.store, job.sessionId, await failureChange(this.store, job, job.error));
          }
        }
      }
      const active = new Set([...this.jobs.values()].filter((job) => job.status === "RUNNING").map((job) => job.sessionId));
      const job = [...this.jobs.values()].find((candidate) => candidate.status === "PENDING" && candidate.availableAt <= now && !active.has(candidate.sessionId) && this.current.get(`${candidate.sessionId}:${candidate.kind}`) === candidate.id);
      if (!job) return null;
      Object.assign(job, { status: "RUNNING", attempts: job.attempts + 1, leaseUntil: now + 60_000, token: newId("lease") });
      return { ...job };
    });
  }

  async isCurrent(job: PlatformJob) {
    const stored = this.jobs.get(job.id);
    return this.current.get(`${job.sessionId}:${job.kind}`) === job.id && stored?.status === "RUNNING" && stored.token === job.token && (stored.leaseUntil ?? 0) > Date.now() && (job.kind === "CLEANUP" || !!(await this.store.findSession(job.sessionId)));
  }

  renew(job: PlatformJob, now: number) {
    return this.locked(async () => {
      const stored = this.jobs.get(job.id);
      if (stored?.status !== "RUNNING" || stored.token !== job.token || (stored.leaseUntil ?? 0) <= Date.now()) return false;
      stored.leaseUntil = now + 60_000;
      return true;
    });
  }

  publish(job: PlatformJob, work: () => Promise<void>) {
    return this.locked(async () => {
      if (!(await this.isCurrent(job))) return false;
      await work();
      return true;
    });
  }

  complete(job: PlatformJob, change: JobChange = {}) {
    return this.locked(async () => {
      if (!(await this.isCurrent(job))) {
        const stored = this.jobs.get(job.id);
        if (stored?.token === job.token && (this.current.get(`${job.sessionId}:${job.kind}`) !== job.id || (job.kind !== "CLEANUP" && !(await this.store.findSession(job.sessionId))))) stored.status = "CANCELLED";
        return false;
      }
      await applyChange(this.store, job.sessionId, change);
      this.jobs.get(job.id)!.status = "DONE";
      if (change.next) await this.schedule(job.sessionId, change.next.kind, change.next.payload, {}, change.next.availableAt);
      return true;
    });
  }

  fail(job: PlatformJob, error: string, retry: boolean, change: JobChange = {}) {
    return this.locked(async () => {
      const stored = this.jobs.get(job.id);
      if (!(await this.isCurrent(job))) {
        if (stored?.token === job.token && (this.current.get(`${job.sessionId}:${job.kind}`) !== job.id || (job.kind !== "CLEANUP" && !(await this.store.findSession(job.sessionId))))) stored.status = "CANCELLED";
        return;
      }
      const pending = retry && job.attempts < 3;
      if (!pending) await applyChange(this.store, job.sessionId, change);
      Object.assign(stored!, { status: pending ? "PENDING" : "FAILED", error, token: null, leaseUntil: null, availableAt: Date.now() + 1000 * 2 ** job.attempts });
    });
  }

  async deleteSession(sessionId: string, recordingCleanupDelayMs = 0) {
    await this.locked(async () => {
      if (!(await this.store.findSession(sessionId))) return;
      const payload = recordingCleanup(await this.store.listRecordings(sessionId), recordingCleanupDelayMs);
      for (const job of this.jobs.values()) if (job.sessionId === sessionId) job.status = "CANCELLED";
      await this.store.deleteSession(sessionId);
      await this.schedule(sessionId, "CLEANUP", payload);
    });
  }
}
