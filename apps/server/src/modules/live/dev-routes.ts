/**
 * OWNER: Ashwath. Direct HTTP access to the CaptionEngine for development (disabled in production):
 *
 *   curl -XPOST localhost:3000/api/dev/captions/refine -H 'content-type: application/json' -d @sample.json
 *
 * Bodies are exactly the CaptionEngine input schemas from @sightline/contracts.
 */
import { ComposeSentenceInput, RefineCaptionInput, type CaptionEngine } from "@sightline/contracts";
import { Elysia } from "elysia";

export const captionDevRoutes = (engine: CaptionEngine) =>
  new Elysia({ prefix: "/api/dev/captions" })
    .get("/", () => ({ engine: engine.name }))
    .post("/refine", ({ body }) => engine.refineCaption(body), { body: RefineCaptionInput })
    .post("/compose-sign", ({ body }) => engine.composeSignSentence(body), { body: ComposeSentenceInput });
