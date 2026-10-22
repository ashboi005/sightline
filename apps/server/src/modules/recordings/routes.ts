/** Session recordings REST — shapes in packages/contracts/src/api.ts (createRecording … listRecordings). */
import { CreateRecordingInput, CreateRecordingSegmentInput } from "@sightline/contracts";
import { Elysia } from "elysia";

import { notFound } from "../../lib/errors";
import type { SessionStore, UserResolver } from "../../shared/ports";
import type { RecordingService } from "./recording-service";

export const recordingRoutes = (deps: { store: SessionStore; resolveUser: UserResolver; recordings: RecordingService }) => {
  const { store, recordings } = deps;
  return new Elysia({ prefix: "/api/sessions/:sessionId/recordings" })
    .resolve(async ({ request, params }) => {
      const user = await deps.resolveUser(request);
      if (!(await store.getSession(user.id, params.sessionId))) throw notFound("Session");
      return { user };
    })
    .get("/", async ({ params }) => ({ data: await recordings.list(params.sessionId) }))
    .post("/", async ({ params, body, status }) => status(201, await recordings.create(params.sessionId, body)), {
      body: CreateRecordingInput,
    })
    .post(
      "/:recordingId/segments",
      async ({ params, body, status }) => status(201, await recordings.reserveSegment(params.sessionId, params.recordingId, body)),
      { body: CreateRecordingSegmentInput },
    )
    .post("/:recordingId/segments/:index/complete", ({ params }) =>
      recordings.completeSegment(params.sessionId, params.recordingId, Number(params.index)),
    )
    .post("/:recordingId/finish", ({ params }) => recordings.finish(params.sessionId, params.recordingId));
};
