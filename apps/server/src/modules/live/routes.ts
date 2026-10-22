/**
 * OWNER: Ashwath. REST routes for live data (transcript + sign utterances). Shapes: packages/contracts/src/api.ts.
 */
import { CreateSignUtteranceInput } from "@sightline/contracts";
import { Elysia } from "elysia";

import { notFound } from "../../lib/errors";
import type { SessionStore, UserResolver } from "../../shared/ports";
import type { SignUtterances } from "./sign-utterances";

export const liveRoutes = (deps: { store: SessionStore; resolveUser: UserResolver; sign: SignUtterances }) => {
  const { store, sign } = deps;

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
    .get("/sign/utterances", async ({ params }) => ({ data: await store.listUtterances(params.sessionId) }));
};
