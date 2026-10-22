/**
 * OWNER: Tushar. Session-owned binary assets (uploaded decks, slide images, TTS audio, snapshots), served at
 * GET /api/assets/:id after an owner check.
 *
 * Bytes live in ObjectStorage (S3 in production — lib/storage.ts); ownership/content-type metadata lives in an
 * AssetIndex (Postgres `platform_asset`, or memory in mock mode). The route checks ownership, then redirects to a
 * short-lived presigned S3 GET (no local disk needed on Coolify).
 */
import type { Database } from "@sightline/db";
import { lectureSession, platformAsset } from "@sightline/db/schema/sightline";
import { eq } from "drizzle-orm";

import { notFound } from "../../../lib/errors";
import { newId } from "../../../lib/ids";
import type { ObjectStorage } from "../../../lib/storage";
import type { SessionStore } from "../store/types";

export type StoredAsset = { contentType: string; bytes: Uint8Array };
export interface AssetStore {
  put(contentType: string, bytes: Uint8Array, sessionId: string): Promise<string>;
  get(assetId: string): Promise<StoredAsset | null>;
  getSessionId(assetId: string): Promise<string | null>;
  deleteSession(sessionId: string): Promise<void>;
  /** Short-lived direct URL (S3 presigned GET) — only call after the ownership check. Null = stream via get(). */
  directUrl?(assetId: string): Promise<string | null>;
}

const ASSET_ID = /^ast_[a-z0-9]+$/;

/** Ownership + content-type metadata for assets whose bytes live in ObjectStorage. */
export interface AssetIndex {
  /** Must fail (throw notFound) if the session doesn't exist. */
  record(assetId: string, sessionId: string, contentType: string): Promise<void>;
  lookup(assetId: string): Promise<{ sessionId: string; contentType: string } | null>;
  listSession(sessionId: string): Promise<string[]>;
  removeSession(sessionId: string): Promise<void>;
}

export class PostgresAssetIndex implements AssetIndex {
  constructor(private readonly db: Database) {}

  async record(assetId: string, sessionId: string, contentType: string) {
    await this.db.transaction(async (transaction) => {
      const [session] = await transaction.select({ id: lectureSession.id }).from(lectureSession).where(eq(lectureSession.id, sessionId)).for("key share");
      if (!session) throw notFound("Session");
      await transaction.insert(platformAsset).values({ id: assetId, sessionId, contentType });
    });
  }
  async lookup(assetId: string) {
    const [row] = await this.db.select().from(platformAsset).where(eq(platformAsset.id, assetId));
    return row ? { sessionId: row.sessionId, contentType: row.contentType } : null;
  }
  async listSession(sessionId: string) {
    return (await this.db.select({ id: platformAsset.id }).from(platformAsset).where(eq(platformAsset.sessionId, sessionId))).map((r) => r.id);
  }
  async removeSession(sessionId: string) {
    await this.db.delete(platformAsset).where(eq(platformAsset.sessionId, sessionId));
  }
}

export class MemoryAssetIndex implements AssetIndex {
  private readonly rows = new Map<string, { sessionId: string; contentType: string }>();
  constructor(private readonly store: SessionStore) {}

  async record(assetId: string, sessionId: string, contentType: string) {
    if (!(await this.store.findSession(sessionId))) throw notFound("Session");
    this.rows.set(assetId, { sessionId, contentType });
  }
  async lookup(assetId: string) {
    return this.rows.get(assetId) ?? null;
  }
  async listSession(sessionId: string) {
    return [...this.rows].filter(([, row]) => row.sessionId === sessionId).map(([id]) => id);
  }
  async removeSession(sessionId: string) {
    for (const [id, row] of this.rows) if (row.sessionId === sessionId) this.rows.delete(id);
  }
}

/** Bytes in ObjectStorage at `assets/<sessionId>/<assetId>`, metadata in the AssetIndex. */
export class ObjectAssetStore implements AssetStore {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly index: AssetIndex,
  ) {}

  private key(sessionId: string, assetId: string) {
    return `assets/${sessionId}/${assetId}`;
  }

  async put(contentType: string, bytes: Uint8Array, sessionId: string) {
    const id = newId("ast");
    await this.storage.putObject(this.key(sessionId, id), bytes, contentType);
    try {
      await this.index.record(id, sessionId, contentType);
    } catch (error) {
      await this.storage.deleteObject(this.key(sessionId, id)).catch(() => {});
      throw error;
    }
    return id;
  }

  async getSessionId(assetId: string) {
    if (!ASSET_ID.test(assetId)) return null;
    return (await this.index.lookup(assetId))?.sessionId ?? null;
  }

  async get(assetId: string): Promise<StoredAsset | null> {
    if (!ASSET_ID.test(assetId)) return null;
    const row = await this.index.lookup(assetId);
    if (!row) return null;
    const object = await this.storage.getObject(this.key(row.sessionId, assetId));
    return object ? { contentType: row.contentType, bytes: object.bytes } : null;
  }

  async directUrl(assetId: string) {
    if (this.storage.driver !== "s3" || !ASSET_ID.test(assetId)) return null;
    const row = await this.index.lookup(assetId);
    if (!row) return null;
    return this.storage.presignDownload(this.key(row.sessionId, assetId), { expiresIn: 600, contentType: row.contentType });
  }

  async deleteSession(sessionId: string) {
    for (const id of await this.index.listSession(sessionId)) {
      await this.storage.deleteObject(this.key(sessionId, id));
    }
    await this.index.removeSession(sessionId);
  }
}

/** In-process store (bytes + ownership in memory) for unit tests. */
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
