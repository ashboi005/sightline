/**
 * Object storage with a presigned-URL flow (shared infra; owner TBD — scaffolded by Ashwath).
 *
 *   STORAGE_DRIVER=s3     → any S3-compatible store (AWS S3, Cloudflare R2, MinIO) via Bun's built-in S3 client.
 *   STORAGE_DRIVER=local  → files under STORAGE_DIR; "presigned" URLs are HMAC-signed URLs served by this server,
 *                           so the browser flow (PUT to a URL, GET from a URL) is identical in dev and prod.
 *
 * Big uploads (recordings) never pass through the API server: the client PUTs straight to `presignUpload().url`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export type PresignedUpload = { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: number };
export type StoredObject = { bytes: Uint8Array; contentType: string };

export interface ObjectStorage {
  readonly driver: "s3" | "local";
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  /** Size + type, or null when the object doesn't exist (used to confirm direct uploads). */
  stat(key: string): Promise<{ size: number; contentType: string } | null>;
  presignUpload(key: string, options: { contentType: string; expiresIn?: number }): Promise<PresignedUpload>;
  presignDownload(key: string, options?: { expiresIn?: number; contentType?: string }): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

const DEFAULT_TTL = 3600;

/** Keys are app-generated, but never allow traversal or absolute paths. */
export function assertSafeKey(key: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,400}$/.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return key;
}

// ---------------------------------------------------------------------------
// S3-compatible
// ---------------------------------------------------------------------------

export type S3Options = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com or http://minio:9000; empty for AWS. */
  endpoint?: string;
  urlTtlSeconds?: number;
};

export class S3ObjectStorage implements ObjectStorage {
  readonly driver = "s3";
  private readonly client: Bun.S3Client;
  private readonly ttl: number;

  constructor(options: S3Options) {
    this.client = new Bun.S3Client({
      bucket: options.bucket,
      region: options.region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      endpoint: options.endpoint || undefined,
    });
    this.ttl = options.urlTtlSeconds ?? DEFAULT_TTL;
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string) {
    await this.client.write(assertSafeKey(key), bytes, { type: contentType });
  }

  async getObject(key: string) {
    const file = this.client.file(assertSafeKey(key));
    if (!(await file.exists())) return null;
    const info = await file.stat();
    return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: info.type || "application/octet-stream" };
  }

  async stat(key: string) {
    const file = this.client.file(assertSafeKey(key));
    if (!(await file.exists())) return null;
    const info = await file.stat();
    return { size: info.size, contentType: info.type || "application/octet-stream" };
  }

  async presignUpload(key: string, options: { contentType: string; expiresIn?: number }) {
    const expiresIn = options.expiresIn ?? this.ttl;
    const url = this.client.file(assertSafeKey(key)).presign({ method: "PUT", expiresIn, type: options.contentType });
    return { url, method: "PUT" as const, headers: { "content-type": options.contentType }, expiresAt: Date.now() + expiresIn * 1000 };
  }

  async presignDownload(key: string, options: { expiresIn?: number; contentType?: string } = {}) {
    return this.client
      .file(assertSafeKey(key))
      .presign({ method: "GET", expiresIn: options.expiresIn ?? this.ttl, type: options.contentType });
  }

  async deleteObject(key: string) {
    await this.client.delete(assertSafeKey(key));
  }
}

// ---------------------------------------------------------------------------
// Local (dev / mocks): disk + HMAC-signed URLs served by /api/storage/*
// ---------------------------------------------------------------------------

type TokenPayload = { k: string; m: "PUT" | "GET"; e: number; t?: string };

export class LocalObjectStorage implements ObjectStorage {
  readonly driver = "local";

  constructor(
    private readonly options: { dir: string; publicUrl: string; secret: string; urlTtlSeconds?: number },
  ) {}

  private path(key: string) {
    const full = normalize(join(this.options.dir, assertSafeKey(key)));
    if (!full.startsWith(normalize(this.options.dir))) throw new Error("Unsafe storage key");
    return full;
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string) {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await Bun.write(file, bytes);
    await Bun.write(`${file}.type`, contentType);
  }

  async getObject(key: string) {
    const file = Bun.file(this.path(key));
    if (!(await file.exists())) return null;
    const typeFile = Bun.file(`${this.path(key)}.type`);
    const contentType = (await typeFile.exists()) ? await typeFile.text() : "application/octet-stream";
    return { bytes: new Uint8Array(await file.arrayBuffer()), contentType };
  }

  async stat(key: string) {
    try {
      const info = await stat(this.path(key));
      const typeFile = Bun.file(`${this.path(key)}.type`);
      return { size: info.size, contentType: (await typeFile.exists()) ? await typeFile.text() : "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async presignUpload(key: string, options: { contentType: string; expiresIn?: number }) {
    const expiresIn = options.expiresIn ?? this.options.urlTtlSeconds ?? DEFAULT_TTL;
    const token = this.sign({ k: assertSafeKey(key), m: "PUT", e: Date.now() + expiresIn * 1000, t: options.contentType });
    return {
      url: `${this.options.publicUrl}/api/storage/upload/${token}`,
      method: "PUT" as const,
      headers: { "content-type": options.contentType },
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  async presignDownload(key: string, options: { expiresIn?: number } = {}) {
    const expiresIn = options.expiresIn ?? this.options.urlTtlSeconds ?? DEFAULT_TTL;
    const token = this.sign({ k: assertSafeKey(key), m: "GET", e: Date.now() + expiresIn * 1000 });
    return `${this.options.publicUrl}/api/storage/object/${token}`;
  }

  async deleteObject(key: string) {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.type`, { force: true });
  }

  sign(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", this.options.secret).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  /** Validate a token from /api/storage/*: returns the payload, or null if forged/expired/wrong method. */
  verify(token: string, method: "PUT" | "GET"): TokenPayload | null {
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = createHmac("sha256", this.options.secret).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
      if (payload.m !== method || payload.e < Date.now()) return null;
      assertSafeKey(payload.k);
      return payload;
    } catch {
      return null;
    }
  }
}
