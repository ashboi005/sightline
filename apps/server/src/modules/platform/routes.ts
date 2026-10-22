/**
 * OWNER: Tushar. Session / context / slides / notes REST routes — must match packages/contracts/src/api.ts.
 * Transcript + sign utterance routes live in modules/live/routes.ts (Ashwath).
 */
import {
  CreateSessionInput,
  ExportNotesQuery,
  PaginationQuery,
  SetContextTextInput,
  SLIDE_UPLOAD_ACCEPT,
  SLIDE_UPLOAD_MAX_BYTES,
  UpdateSessionInput,
  type HealthResponse,
} from "@sightline/contracts";
import { Elysia } from "elysia";

import { AppError, notFound } from "../../lib/errors";
import type { AssetStore } from "./assets/asset-store";
import type { UserResolver } from "./auth";
import type { PlatformService } from "./platform-service";

export const platformRoutes = (deps: {
  platform: PlatformService;
  assets: AssetStore;
  resolveUser: UserResolver;
  health: () => HealthResponse;
}) => {
  const { platform: svc, assets, resolveUser } = deps;

  return (
    new Elysia({ prefix: "/api" })
      // --- public ----------------------------------------------------------
      .get("/health", () => deps.health())
      .get("/assets/:assetId", async ({ params }) => {
        const asset = await assets.get(params.assetId);
        if (!asset) throw notFound("Asset");
        return new Response(asset.bytes, {
          headers: { "content-type": asset.contentType, "cache-control": "public, max-age=31536000, immutable" },
        });
      })

      // --- authenticated ---------------------------------------------------
      .resolve(async ({ request }) => ({ user: await resolveUser(request) }))
      .get("/me", ({ user }) => user)

      .get("/sessions", ({ user, query }) => svc.listSessions(user.id, query.page, query.pageSize), {
        query: PaginationQuery,
      })
      .post("/sessions", async ({ user, body, status }) => status(201, await svc.createSession(user.id, body)), {
        body: CreateSessionInput,
      })
      .get("/sessions/:sessionId", ({ user, params }) => svc.requireSession(user.id, params.sessionId))
      .patch("/sessions/:sessionId", ({ user, params, body }) => svc.updateSession(user.id, params.sessionId, body), {
        body: UpdateSessionInput,
      })
      .delete("/sessions/:sessionId", async ({ user, params }) => {
        await svc.deleteSession(user.id, params.sessionId);
        return new Response(null, { status: 204 });
      })
      .post("/sessions/:sessionId/start", ({ user, params }) => svc.startSession(user.id, params.sessionId))
      .post("/sessions/:sessionId/end", ({ user, params }) => svc.endSession(user.id, params.sessionId))

      .get("/sessions/:sessionId/context", ({ user, params }) => svc.getContext(user.id, params.sessionId))
      .put(
        "/sessions/:sessionId/context/text",
        async ({ user, params, body, status }) =>
          status(202, await svc.setContextText(user.id, params.sessionId, body.text)),
        { body: SetContextTextInput },
      )
      .post("/sessions/:sessionId/slides", async ({ user, params, body, status }) => {
        const file = (body as { file?: unknown } | null)?.file;
        if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", 'Expected multipart field "file"');
        if (file.size > SLIDE_UPLOAD_MAX_BYTES) throw new AppError("VALIDATION_ERROR", "File larger than 50 MB");
        if (!SLIDE_UPLOAD_ACCEPT.some((ext) => file.name.toLowerCase().endsWith(ext))) {
          throw new AppError("VALIDATION_ERROR", `Accepted: ${SLIDE_UPLOAD_ACCEPT.join(", ")}`);
        }
        return status(202, await svc.uploadSlides(user.id, params.sessionId, file));
      })
      .get("/sessions/:sessionId/slides", ({ user, params }) => svc.getSlides(user.id, params.sessionId))


      .get("/sessions/:sessionId/notes", ({ user, params }) => svc.getNotes(user.id, params.sessionId))
      .post("/sessions/:sessionId/notes", async ({ user, params, status }) =>
        status(202, await svc.regenerateNotes(user.id, params.sessionId)),
      )
      .get(
        "/sessions/:sessionId/notes/export",
        async ({ user, params }) =>
          new Response(await svc.exportNotesMarkdown(user.id, params.sessionId), {
            headers: {
              "content-type": "text/markdown; charset=utf-8",
              "content-disposition": `attachment; filename="${params.sessionId}-notes.md"`,
            },
          }),
        { query: ExportNotesQuery },
      )
  );
};
