/**
 * OWNER: Tushar. Binary assets (uploaded decks, rendered slide images, TTS audio, snapshots), served at
 * GET /api/assets/:id. Backed by ObjectStorage (local disk in dev, S3 in prod — see lib/storage.ts).
 */
import type { ObjectStorage } from "../../../lib/storage";
import { newId } from "../../../lib/ids";

export type StoredAsset = { contentType: string; bytes: Uint8Array };

export interface AssetStore {
  put(contentType: string, bytes: Uint8Array): Promise<string>;
  get(assetId: string): Promise<StoredAsset | null>;
  /** Short-lived direct URL (S3 presigned GET) so large assets bypass the API server; null = stream via get(). */
  directUrl?(assetId: string): Promise<string | null>;
}

const ASSET_ID = /^ast_[a-z0-9]+$/;

/** Assets as objects under `assets/<id>` in the configured ObjectStorage. */
export class ObjectAssetStore implements AssetStore {
  constructor(private readonly storage: ObjectStorage) {}

  async put(contentType: string, bytes: Uint8Array) {
    const id = newId("ast");
    await this.storage.putObject(`assets/${id}`, bytes, contentType);
    return id;
  }

  async get(assetId: string) {
    if (!ASSET_ID.test(assetId)) return null;
    return this.storage.getObject(`assets/${assetId}`);
  }

  async directUrl(assetId: string) {
    if (this.storage.driver !== "s3" || !ASSET_ID.test(assetId)) return null;
    if (!(await this.storage.stat(`assets/${assetId}`))) return null;
    return this.storage.presignDownload(`assets/${assetId}`, { expiresIn: 3600 });
  }
}

/** In-process store for unit tests. */
export class MemoryAssetStore implements AssetStore {
  private readonly assets = new Map<string, StoredAsset>();

  async put(contentType: string, bytes: Uint8Array) {
    const id = newId("ast");
    this.assets.set(id, { contentType, bytes });
    return id;
  }

  async get(assetId: string) {
    return this.assets.get(assetId) ?? null;
  }
}
