/**
 * OWNER: Ashwath. REST routes for live data (transcript + sign utterances). Shapes: packages/contracts/src/api.ts.
 */
import { CreateSignUtteranceInput, CreateSnapshotFields, SNAPSHOT_ACCEPT, SNAPSHOT_MAX_BYTES } from "@sightline/contracts";
import { Elysia } from "elysia";

import { AppError, notFound } from "../../lib/errors";
import type { SessionStore, UserResolver } from "../../shared/ports";
import type { SignUtterances } from "./sign-utterances";
import type { SnapshotService } from "./snapshots/snapshot-service";

export const liveRoutes = (deps: {
  store: SessionStore;
  resolveUser: UserResolver;
  sign: SignUtterances;
  snapshots: SnapshotService;
}) => {
  const { store, sign, snapshots } = deps;

  return new Elysia({ prefix: "/api/sessions/:sessionId" })
    .resolve(async ({ request, params }) => {
      const user = await deps.resolveUser(request);
      if (!(await store.getSession(user.id, params.sessionId))) throw notFound("Session");
      return { user };
    })
    .get("/transcript", async ({ params }) => ({ data: await store.listSegments(params.sessionId) }))
    .post(
      "/sign/utterances",
      async ({ params, body, status }) => status(201, await sign.create(params.sessionId, body)),
      { body: CreateSignUtteranceInput },
    )
    .get("/sign/utterances", async ({ params }) => ({ data: await store.listUtterances(params.sessionId) }))
    .post("/snapshots", async ({ params, body, status }) => {
      const form = (body ?? {}) as Record<string, unknown>;
      const file = form.file;
      if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", 'Expected multipart image field "file"');
      if (file.size > SNAPSHOT_MAX_BYTES) throw new AppError("VALIDATION_ERROR", "Snapshot larger than 5 MB");
      const mimeType = file.type || "image/jpeg";
      if (!(SNAPSHOT_ACCEPT as readonly string[]).includes(mimeType)) {
        throw new AppError("VALIDATION_ERROR", `Accepted image types: ${SNAPSHOT_ACCEPT.join(", ")}`);
      }
      const fields = CreateSnapshotFields.safeParse({ trigger: form.trigger, reason: form.reason ?? "", capturedAt: form.capturedAt });
      if (!fields.success) throw new AppError("VALIDATION_ERROR", "Invalid snapshot fields", fields.error.issues);
      const snapshot = await snapshots.create(
        params.sessionId,
        { bytes: new Uint8Array(await file.arrayBuffer()), mimeType },
        fields.data,
      );
      return status(201, snapshot);
    })
    .get("/snapshots", async ({ params }) => ({ data: await snapshots.list(params.sessionId) }));
};
