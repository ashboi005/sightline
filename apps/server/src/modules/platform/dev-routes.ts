/**
 * OWNER: Tushar. Direct HTTP access to the KnowledgeEngine + NotesEngine for development (disabled in production).
 * Bodies are exactly the input schemas from @sightline/contracts.
 */
import {
  GenerateNotesInput,
  IngestContextInput,
  RetrieveContextInput,
  type KnowledgeEngine,
  type NotesEngine,
} from "@sightline/contracts";
import { Elysia } from "elysia";

export const platformDevRoutes = (knowledge: KnowledgeEngine, notes: NotesEngine) =>
  new Elysia({ prefix: "/api/dev" })
    .get("/knowledge", () => ({ engine: knowledge.name }))
    .post("/knowledge/ingest", ({ body }) => knowledge.ingestContext(body), { body: IngestContextInput })
    .get("/knowledge/glossary/:sessionId", ({ params }) => knowledge.getGlossary(params.sessionId))
    .post("/knowledge/retrieve", ({ body }) => knowledge.retrieveContext(body), { body: RetrieveContextInput })
    .get("/notes", () => ({ engine: notes.name }))
    .post("/notes", ({ body }) => notes.generateNotes(body), { body: GenerateNotesInput });
