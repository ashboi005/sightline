/**
 * Serves the "presigned" URLs of the LOCAL storage driver (dev / mocks). With STORAGE_DRIVER=s3 these routes are
 * not mounted — browsers talk to S3 directly. Tokens are HMAC-signed, method-bound and expiring (lib/storage.ts).
 */
import { Elysia } from "elysia";

import { RECORDING_SEGMENT_MAX_BYTES } from "@sightline/contracts";

import type { LocalObjectStorage } from "./storage";

export const localStorageRoutes = (storage: LocalObjectStorage) =>
  new Elysia({ prefix: "/api/storage" })
    .put(
      "/upload/:token",
      async ({ params, request }) => {
        const grant = storage.verify(params.token, "PUT");
        if (!grant) return new Response("Invalid or expired upload URL", { status: 403 });
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0) return new Response("Empty upload", { status: 400 });
        if (bytes.byteLength > RECORDING_SEGMENT_MAX_BYTES) return new Response("Too large", { status: 413 });
        await storage.putObject(grant.k, bytes, grant.t ?? request.headers.get("content-type") ?? "application/octet-stream");
        return new Response(null, { status: 200 });
      },
      { parse: "none" },
    )
    .get("/object/:token", async ({ params, request }) => {
      const grant = storage.verify(params.token, "GET");
      if (!grant) return new Response("Invalid or expired URL", { status: 403 });
      const object = await storage.getObject(grant.k);
      if (!object) return new Response("Not found", { status: 404 });
      return rangeResponse(object.bytes, object.contentType, request.headers.get("range"));
    });

/** Byte ranges so <video> can seek through recordings in dev. */
function rangeResponse(bytes: Uint8Array, contentType: string, range: string | null) {
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return new Response(bytes, { headers: { "content-type": contentType, "accept-ranges": "bytes", "content-length": String(bytes.byteLength) } });
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.byteLength - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
  if (start > end || start >= bytes.byteLength) return new Response(null, { status: 416, headers: { "content-range": `bytes */${bytes.byteLength}` } });
  return new Response(bytes.subarray(start, end + 1), {
    status: 206,
    headers: {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${bytes.byteLength}`,
      "content-length": String(end - start + 1),
    },
  });
}
