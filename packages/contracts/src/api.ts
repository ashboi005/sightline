/**
 * REST route catalog — web app ↔ server. Human-readable version: docs/contracts/rest-api.md.
 *
 * - All bodies are JSON except `uploadSlides` (multipart/form-data, field "file") and `exportNotes` (text/markdown).
 * - Every non-2xx response is an `ApiError`.
 * - Auth: better-auth session cookie (fetch with `credentials: "include"`). MOCK_AUTH=true skips it.
 */
import { z } from "zod";

import { CaptionSegment } from "./domain/captions";
import { PaginationQuery, paginated } from "./domain/common";
import { ContextState, SetContextTextInput, SlideDeck } from "./domain/context";
import { NotesResponse } from "./domain/notes";
import {
  CreateSessionInput,
  CurrentUser,
  HealthResponse,
  Session,
  UpdateSessionInput,
} from "./domain/session";
import { CreateSignUtteranceInput, SignUtterance } from "./domain/sign";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RouteDef = {
  method: Method;
  path: string;
  status: number;
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  response: z.ZodType | null;
};

const route = <const R extends RouteDef>(r: R) => r;

export const SLIDE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const SLIDE_UPLOAD_ACCEPT = [".pdf", ".ppt", ".pptx"] as const;

export const ListResponse = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

export const ExportNotesQuery = z.object({ format: z.enum(["md"]).default("md") });

export const routes = {
  health: route({
    method: "GET",
    path: "/api/health",
    status: 200,
    summary: "Liveness + which modules are mocked",
    response: HealthResponse,
  }),
  me: route({
    method: "GET",
    path: "/api/me",
    status: 200,
    summary: "Current user (demo user when MOCK_AUTH)",
    response: CurrentUser,
  }),

  // --- sessions ------------------------------------------------------------
  listSessions: route({
    method: "GET",
    path: "/api/sessions",
    status: 200,
    summary: "Past and current lecture sessions, newest first",
    query: PaginationQuery,
    response: paginated(Session),
  }),
  createSession: route({
    method: "POST",
    path: "/api/sessions",
    status: 201,
    summary: "Create a DRAFT session (Phase 1)",
    body: CreateSessionInput,
    response: Session,
  }),
  getSession: route({
    method: "GET",
    path: "/api/sessions/:sessionId",
    status: 200,
    summary: "One session",
    response: Session,
  }),
  updateSession: route({
    method: "PATCH",
    path: "/api/sessions/:sessionId",
    status: 200,
    summary: "Rename / switch mode (allowed while LIVE)",
    body: UpdateSessionInput,
    response: Session,
  }),
  deleteSession: route({
    method: "DELETE",
    path: "/api/sessions/:sessionId",
    status: 204,
    summary: "Delete a session and everything attached (idempotent)",
    response: null,
  }),
  startSession: route({
    method: "POST",
    path: "/api/sessions/:sessionId/start",
    status: 200,
    summary: "DRAFT → LIVE. Then open the session WebSocket.",
    response: Session,
  }),
  endSession: route({
    method: "POST",
    path: "/api/sessions/:sessionId/end",
    status: 200,
    summary: "LIVE → ENDED. Kicks off notes generation automatically.",
    response: Session,
  }),

  // --- context & slides ----------------------------------------------------
  getContext: route({
    method: "GET",
    path: "/api/sessions/:sessionId/context",
    status: 200,
    summary: "Context status, topics and glossary",
    response: ContextState,
  }),
  setContextText: route({
    method: "PUT",
    path: "/api/sessions/:sessionId/context/text",
    status: 202,
    summary: "Option B — set free-text lecture context (re-ingests)",
    body: SetContextTextInput,
    response: ContextState,
  }),
  uploadSlides: route({
    method: "POST",
    path: "/api/sessions/:sessionId/slides",
    status: 202,
    summary: "Option A — multipart upload, field 'file' (.pdf/.ppt/.pptx, ≤ 50 MB). Poll getSlides.",
    response: SlideDeck,
  }),
  getSlides: route({
    method: "GET",
    path: "/api/sessions/:sessionId/slides",
    status: 200,
    summary: "Slide deck with page image URLs (404 if none uploaded)",
    response: SlideDeck,
  }),

  // --- live data -----------------------------------------------------------
  getTranscript: route({
    method: "GET",
    path: "/api/sessions/:sessionId/transcript",
    status: 200,
    summary: "All FINAL/REFINED caption segments so far, ordered by seq (use after reconnect)",
    response: ListResponse(CaptionSegment),
  }),
  createSignUtterance: route({
    method: "POST",
    path: "/api/sessions/:sessionId/sign/utterances",
    status: 201,
    summary: "Gloss tokens → sentence (+ TTS audio). Also broadcast as sign.utterance.",
    body: CreateSignUtteranceInput,
    response: SignUtterance,
  }),
  listSignUtterances: route({
    method: "GET",
    path: "/api/sessions/:sessionId/sign/utterances",
    status: 200,
    summary: "Sign conversation history for the session",
    response: ListResponse(SignUtterance),
  }),

  // --- notes ---------------------------------------------------------------
  getNotes: route({
    method: "GET",
    path: "/api/sessions/:sessionId/notes",
    status: 200,
    summary: "Notes + generation status",
    response: NotesResponse,
  }),
  regenerateNotes: route({
    method: "POST",
    path: "/api/sessions/:sessionId/notes",
    status: 202,
    summary: "Regenerate notes for an ENDED session",
    response: NotesResponse,
  }),
  exportNotes: route({
    method: "GET",
    path: "/api/sessions/:sessionId/notes/export",
    status: 200,
    summary: "Download notes as text/markdown",
    query: ExportNotesQuery,
    response: null,
  }),
} as const;

export type RouteName = keyof typeof routes;

/** Fill `:params` in a route path. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing path param "${key}" for ${path}`);
    return encodeURIComponent(value);
  });
}
