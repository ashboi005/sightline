import type { Database } from "@sightline/db";
import { lectureSession, platformJob, platformWork } from "@sightline/db/schema/sightline";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { newId } from "../../../lib/ids";
import { PostgresStore } from "../store/postgres-store";
import { applyChange, failureChange } from "./memory-jobs";
import type { JobChange, JobKind, JobPayload, JobRepository, PlatformJob } from "./types";

export class PostgresJobs implements JobRepository {
  constructor(private readonly db: Database) {}

  private atomic<Result>(work: (database: Database) => Promise<Result>, sessionId?: string) {
    return this.db.transaction(async (transaction) => {
      if (sessionId) await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`);
      else await transaction.execute(sql`select pg_advisory_xact_lock(913481)`);
      return work(transaction as unknown as Database);
    });
  }

  private async schedule(database: Database, sessionId: string, kind: JobKind, payload: JobPayload, change: JobChange): Promise<PlatformJob> {
    const key = `${sessionId}:${kind}`;
    const [previous] = await database.select({ job: platformJob }).from(platformWork).innerJoin(platformJob, eq(platformJob.id, platformWork.jobId)).where(eq(platformWork.key, key));
    if (kind === "NOTES" && previous && ["PENDING", "RUNNING"].includes(previous.job.status)) return previous.job as PlatformJob;
    const store = new PostgresStore(database);
    if (kind !== "CLEANUP" && !(await store.findSession(sessionId))) throw new Error("Session no longer exists");
    if (kind === "CONTEXT") change = { ...change, context: { ...(change.context ?? await store.getContext(sessionId)), status: "PROCESSING", error: null }, session: { ...change.session, contextStatus: "PROCESSING" } };
    await applyChange(store, sessionId, change);
    if (previous?.job.status === "PENDING") await database.update(platformJob).set({ status: "CANCELLED" }).where(eq(platformJob.id, previous.job.id));
    const now = Date.now();
    const job: PlatformJob = { id: newId("job"), sessionId, kind, payload, status: "PENDING", attempts: 0, availableAt: now, createdAt: now, leaseUntil: null, token: null, error: null };
    await database.insert(platformJob).values(job);
    await database.insert(platformWork).values({ key, jobId: job.id }).onConflictDoUpdate({ target: platformWork.key, set: { jobId: job.id } });
    return job;
  }

  enqueue(sessionId: string, kind: JobKind, payload: JobPayload = {}, change: JobChange = {}) {
    return this.atomic((database) => this.schedule(database, sessionId, kind, payload, change), sessionId);
  }

  claim(now: number) {
    return this.atomic(async (database) => {
      const rows = await database.select().from(platformJob).where(or(and(eq(platformJob.status, "PENDING"), lte(platformJob.availableAt, now)), and(eq(platformJob.status, "RUNNING"), lte(platformJob.leaseUntil, now)))).orderBy(platformJob.createdAt, platformJob.id);
      for (const candidate of rows) {
        const lock = await database.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${candidate.sessionId}, 0)) as locked`);
        if (!lock.rows[0]?.locked) continue;
        const [row] = await database.select().from(platformJob).where(eq(platformJob.id, candidate.id));
        if (!row || (row.status !== "PENDING" && !(row.status === "RUNNING" && (row.leaseUntil ?? 0) <= now))) continue;
        const active = await database.select({ id: platformJob.id }).from(platformJob).where(and(eq(platformJob.sessionId, row.sessionId), eq(platformJob.status, "RUNNING"), sql`${platformJob.leaseUntil} > ${now}`));
        if (active.length) continue;
        const [current] = await database.select().from(platformWork).where(eq(platformWork.key, `${row.sessionId}:${row.kind}`));
        if (current?.jobId !== row.id) {
          await database.update(platformJob).set({ status: "CANCELLED" }).where(eq(platformJob.id, row.id));
          continue;
        }
        if (row.attempts >= 3) {
          const error = "Processing was interrupted too many times";
          await database.update(platformJob).set({ status: "FAILED", error, token: null, leaseUntil: null }).where(eq(platformJob.id, row.id));
          const store = new PostgresStore(database);
          await applyChange(store, row.sessionId, await failureChange(store, row as PlatformJob, error));
          continue;
        }
        const job: PlatformJob = { ...row, kind: row.kind as JobKind, status: "RUNNING", attempts: row.attempts + 1, token: newId("lease"), leaseUntil: now + 60_000 };
        await database.update(platformJob).set(job).where(eq(platformJob.id, job.id));
        return job;
      }
      return null;
    });
  }

  private async current(database: Database, job: PlatformJob) {
    const [row] = await database.select().from(platformJob).innerJoin(platformWork, eq(platformWork.jobId, platformJob.id)).where(and(eq(platformJob.id, job.id), eq(platformJob.token, job.token ?? ""), eq(platformJob.status, "RUNNING"), sql`${platformJob.leaseUntil} > ${Date.now()}`));
    if (!row) return false;
    if (job.kind === "CLEANUP") return true;
    const [session] = await database.select({ id: lectureSession.id }).from(lectureSession).where(eq(lectureSession.id, job.sessionId));
    return !!session;
  }

  isCurrent(job: PlatformJob) { return this.current(this.db, job); }

  private async cancelObsolete(database: Database, job: PlatformJob) {
    const [work] = await database.select().from(platformWork).where(eq(platformWork.key, `${job.sessionId}:${job.kind}`));
    if (work?.jobId === job.id && (job.kind === "CLEANUP" || await new PostgresStore(database).findSession(job.sessionId))) return;
    await database.update(platformJob).set({ status: "CANCELLED" }).where(and(eq(platformJob.id, job.id), eq(platformJob.token, job.token ?? "")));
  }

  renew(job: PlatformJob, now: number) {
    return this.atomic(async (database) => {
      const [stored] = await database.select().from(platformJob).where(and(eq(platformJob.id, job.id), eq(platformJob.token, job.token ?? ""), eq(platformJob.status, "RUNNING"), sql`${platformJob.leaseUntil} > ${Date.now()}`));
      if (!stored) return false;
      await database.update(platformJob).set({ leaseUntil: now + 60_000 }).where(eq(platformJob.id, job.id));
      return true;
    }, job.sessionId);
  }

  publish(job: PlatformJob, work: () => Promise<void>) {
    return this.atomic(async (database) => {
      if (!(await this.current(database, job))) return false;
      await database.update(platformJob).set({ leaseUntil: Date.now() + 60_000 }).where(eq(platformJob.id, job.id));
      await work();
      await database.update(platformJob).set({ leaseUntil: Date.now() + 60_000 }).where(eq(platformJob.id, job.id));
      return true;
    }, job.sessionId);
  }

  complete(job: PlatformJob, change: JobChange = {}) {
    return this.atomic(async (database) => {
      if (!(await this.current(database, job))) {
        await this.cancelObsolete(database, job);
        return false;
      }
      await applyChange(new PostgresStore(database), job.sessionId, change);
      await database.update(platformJob).set({ status: "DONE", token: null, leaseUntil: null }).where(eq(platformJob.id, job.id));
      if (change.next) await this.schedule(database, job.sessionId, change.next.kind, change.next.payload ?? {}, {});
      return true;
    }, job.sessionId);
  }

  fail(job: PlatformJob, error: string, retry: boolean, change: JobChange = {}) {
    return this.atomic(async (database) => {
      if (!(await this.current(database, job))) {
        await this.cancelObsolete(database, job);
        return;
      }
      const pending = retry && job.attempts < 3;
      if (!pending) await applyChange(new PostgresStore(database), job.sessionId, change);
      await database.update(platformJob).set({ status: pending ? "PENDING" : "FAILED", error, token: null, leaseUntil: null, availableAt: Date.now() + 1000 * 2 ** job.attempts }).where(eq(platformJob.id, job.id));
    }, job.sessionId);
  }

  deleteSession(sessionId: string) {
    return this.atomic(async (database) => {
      await database.update(platformJob).set({ status: "CANCELLED" }).where(and(eq(platformJob.sessionId, sessionId), inArray(platformJob.status, ["PENDING", "RUNNING"])));
      await database.delete(lectureSession).where(eq(lectureSession.id, sessionId));
      await this.schedule(database, sessionId, "CLEANUP", {}, {});
    }, sessionId);
  }
}
