import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertSafeKey, LocalObjectStorage, S3ObjectStorage } from "./storage";

describe("assertSafeKey", () => {
  it("rejects traversal and odd keys", () => {
    expect(assertSafeKey("recordings/ses_1/rec_1/segment-0000.webm")).toBeTruthy();
    for (const bad of ["../etc/passwd", "/abs", "a//b", "a/../b", "", "a b"]) expect(() => assertSafeKey(bad)).toThrow();
  });
});

describe("LocalObjectStorage", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });
  const make = async (ttl = 60) => {
    const dir = await mkdtemp(join(tmpdir(), "sightline-storage-"));
    dirs.push(dir);
    return new LocalObjectStorage({ dir, publicUrl: "http://api.test", secret: "s".repeat(32), urlTtlSeconds: ttl });
  };

  it("round-trips objects with content type and stat", async () => {
    const s = await make();
    await s.putObject("assets/ast_1", new Uint8Array([1, 2, 3]), "image/png");
    expect(await s.getObject("assets/ast_1")).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    expect(await s.stat("assets/ast_1")).toEqual({ size: 3, contentType: "image/png" });
    expect(await s.stat("assets/missing")).toBeNull();
  });

  it("issues method-bound, key-bound, expiring, unforgeable URLs", async () => {
    const s = await make();
    const up = await s.presignUpload("recordings/a.webm", { contentType: "video/webm" });
    expect(up.url).toStartWith("http://api.test/api/storage/upload/");
    const token = up.url.split("/").at(-1)!;
    expect(s.verify(token, "PUT")).toMatchObject({ k: "recordings/a.webm", m: "PUT", t: "video/webm" });
    expect(s.verify(token, "GET")).toBeNull(); // wrong method
    const [body, mac] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ k: "recordings/other.webm", m: "PUT", e: Date.now() + 1e6 })).toString("base64url")}.${mac}`;
    expect(s.verify(forged, "PUT")).toBeNull();
    expect(s.verify(`${body}.AAAA`, "PUT")).toBeNull();

    const expired = (await make(-1)).sign({ k: "x", m: "GET", e: Date.now() - 1 });
    expect(s.verify(expired, "GET")).toBeNull();
  });
});

describe("S3ObjectStorage (against a fake S3)", () => {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const fake = Bun.serve({
    port: 0,
    async fetch(req) {
      const key = decodeURIComponent(new URL(req.url).pathname);
      if (req.method === "PUT") {
        objects.set(key, { bytes: new Uint8Array(await req.arrayBuffer()), type: req.headers.get("content-type") ?? "" });
        return new Response(null, { status: 200, headers: { etag: '"x"' } });
      }
      const obj = objects.get(key);
      if (!obj) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
      const headers = { "content-type": obj.type, "content-length": String(obj.bytes.length), etag: '"x"', "last-modified": new Date().toUTCString() };
      if (req.method === "HEAD") return new Response(null, { headers });
      if (req.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response(obj.bytes, { headers });
    },
  });
  afterAll(() => fake.stop(true));
  const s3 = new S3ObjectStorage({
    bucket: "sightline",
    region: "us-east-1",
    endpoint: `http://localhost:${fake.port}`,
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret",
  });

  it("puts, stats, gets and deletes objects", async () => {
    await s3.putObject("assets/ast_9", new Uint8Array([7, 8, 9]), "audio/mpeg");
    expect(objects.get("/sightline/assets/ast_9")?.type).toBe("audio/mpeg");
    expect(await s3.stat("assets/ast_9")).toEqual({ size: 3, contentType: "audio/mpeg" });
    expect(await s3.getObject("assets/ast_9")).toEqual({ bytes: new Uint8Array([7, 8, 9]), contentType: "audio/mpeg" });
    await s3.deleteObject("assets/ast_9");
    expect(await s3.stat("assets/ast_9")).toBeNull();
  });

  it("presigns SigV4 PUT and GET URLs that a client can use directly", async () => {
    const up = await s3.presignUpload("recordings/r/segment-0000.webm", { contentType: "video/webm", expiresIn: 600 });
    const url = new URL(up.url);
    expect(url.pathname).toBe("/sightline/recordings/r/segment-0000.webm");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // The browser's PUT to the presigned URL lands in the bucket.
    const put = await fetch(up.url, { method: "PUT", headers: up.headers, body: new Uint8Array([1, 2]) });
    expect(put.ok).toBe(true);
    expect(objects.get("/sightline/recordings/r/segment-0000.webm")?.bytes).toEqual(new Uint8Array([1, 2]));
    const get = new URL(await s3.presignDownload("recordings/r/segment-0000.webm"));
    expect(get.searchParams.has("X-Amz-Signature")).toBe(true);
  });
});
