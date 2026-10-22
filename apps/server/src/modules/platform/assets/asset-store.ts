import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Database } from "@sightline/db";
import { lectureSession, platformAsset } from "@sightline/db/schema/sightline";
import { eq } from "drizzle-orm";
import { newId } from "../../../lib/ids";
import { notFound } from "../../../lib/errors";
import type { SessionStore } from "../store/types";

export type StoredAsset = { contentType: string; bytes: Uint8Array };
export interface AssetStore {
  put(contentType: string, bytes: Uint8Array, sessionId: string): Promise<string>;
  get(assetId: string): Promise<StoredAsset | null>;
  getSessionId(assetId: string): Promise<string | null>;
  deleteSession(sessionId: string): Promise<void>;
}

export class MemoryAssetStore implements AssetStore {
  private readonly assets = new Map<string, StoredAsset & { sessionId: string }>();
  constructor(private readonly store: SessionStore) {}

  async put(contentType: string, bytes: Uint8Array, sessionId: string) {
    if (!(await this.store.findSession(sessionId))) throw notFound("Session");
    const id = newId("ast");
    this.assets.set(id, { contentType, bytes, sessionId });
    return id;
  }
  async get(assetId: string) { return this.assets.get(assetId) ?? null; }
  async getSessionId(assetId: string) { return this.assets.get(assetId)?.sessionId ?? null; }
  async deleteSession(sessionId: string) {
    for (const [id, asset] of this.assets) if (asset.sessionId === sessionId) this.assets.delete(id);
  }
}

export class DiskAssetStore implements AssetStore {
  constructor(private readonly dir: string, private readonly db: Database) {}

  private sessionDirectory(sessionId: string) {
    return join(this.dir, createHash("sha256").update(sessionId).digest("hex"));
  }

  async put(contentType: string, bytes: Uint8Array, sessionId: string) {
    const directory = this.sessionDirectory(sessionId);
    await mkdir(directory, { recursive: true });
    const id = newId("ast");
    const path = join(directory, id);
    try {
      await Bun.write(`${path}.tmp`, bytes);
      await rename(`${path}.tmp`, path);
      await this.db.transaction(async (transaction) => {
        const [session] = await transaction.select({ id: lectureSession.id }).from(lectureSession).where(eq(lectureSession.id, sessionId)).for("key share");
        if (!session) throw notFound("Session");
        await transaction.insert(platformAsset).values({ id, sessionId, contentType });
      });
      return id;
    } catch (error) {
      await Promise.all([rm(path, { force: true }), rm(`${path}.tmp`, { force: true })]);
      throw error;
    }
  }
  async getSessionId(assetId: string) {
    if (!/^ast_[a-z0-9]+$/.test(assetId)) return null;
    const [row] = await this.db.select({ sessionId: platformAsset.sessionId }).from(platformAsset).where(eq(platformAsset.id, assetId));
    return row?.sessionId ?? null;
  }
  async get(assetId: string): Promise<StoredAsset | null> {
    if (!/^ast_[a-z0-9]+$/.test(assetId)) return null;
    const [row] = await this.db.select().from(platformAsset).where(eq(platformAsset.id, assetId));
    if (!row) return null;
    const file = Bun.file(join(this.sessionDirectory(row.sessionId), assetId));
    if (!(await file.exists())) return null;
    return { contentType: row.contentType, bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  async deleteSession(sessionId: string) {
    await rm(this.sessionDirectory(sessionId), { recursive: true, force: true });
    await this.db.delete(platformAsset).where(eq(platformAsset.sessionId, sessionId));
  }
}
