/**
 * OWNER: Ashwath. Direct HTTP access to the IntelligenceEngine for development (disabled in production).
 * Lets you test refinement/notes with curl without sessions, sockets or the frontend:
 *
 *   curl -XPOST localhost:3000/api/dev/intelligence/refine -H 'content-type: application/json' -d @sample.json
 *
 * Bodies are exactly the IntelligenceEngine input schemas from @sightline/contracts.
 */
import {
  ComposeSentenceInput,
  GenerateNotesInput,
  IngestContextInput,
  LocateSlideInput,
  RefineCaptionInput,
  type IntelligenceEngine,
} from "@sightline/contracts";
import { Elysia } from "elysia";

export const intelligenceDevRoutes = (engine: IntelligenceEngine) =>
  new Elysia({ prefix: "/api/dev/intelligence" })
    .get("/", () => ({ engine: engine.name }))
    .post("/ingest", ({ body }) => engine.ingestContext(body), { body: IngestContextInput })
    .get("/glossary/:sessionId", ({ params }) => engine.getGlossary(params.sessionId))
    .post("/refine", ({ body }) => engine.refineCaption(body), { body: RefineCaptionInput })
    .post("/locate-slide", ({ body }) => engine.locateSlide(body), { body: LocateSlideInput })
    .post("/compose-sign", ({ body }) => engine.composeSignSentence(body), { body: ComposeSentenceInput })
    .post("/notes", ({ body }) => engine.generateNotes(body), { body: GenerateNotesInput });
