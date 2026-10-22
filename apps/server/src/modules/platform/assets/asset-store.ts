/**
 * OWNER: Tushar. Binary assets (uploaded decks, rendered slide images, TTS audio), served at GET /api/assets/:id.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { newId } from "../../../lib/ids";

export type StoredAsset = { contentType: string; bytes: Uint8Array };

export interface AssetStore {
  put(contentType: string, bytes: Uint8Array): Promise<string>;
  get(assetId: string): Promise<StoredAsset | null>;
}

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

/** Files on disk under STORAGE_DIR (mount a Coolify volume there in production). */
export class DiskAssetStore implements AssetStore {
  constructor(private readonly dir: string) {}

  async put(contentType: string, bytes: Uint8Array) {
    await mkdir(this.dir, { recursive: true });
    const id = newId("ast");
    await Bun.write(join(this.dir, id), bytes);
    await Bun.write(join(this.dir, `${id}.type`), contentType);
    return id;
  }

  async get(assetId: string) {
    if (!/^ast_[a-z0-9]+$/.test(assetId)) return null;
    const file = Bun.file(join(this.dir, assetId));
    if (!(await file.exists())) return null;
    const contentType = await Bun.file(join(this.dir, `${assetId}.type`)).text();
    return { contentType, bytes: new Uint8Array(await file.arrayBuffer()) };
  }
}
