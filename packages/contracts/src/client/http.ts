import type { z } from "zod";

import { ApiError } from "../domain/common";
import { buildPath, routes, type RouteName } from "../api";
import type { CreateSessionInput, UpdateSessionInput } from "../domain/session";
import type { CreateSignUtteranceInput } from "../domain/sign";

type Infer<N extends RouteName> = (typeof routes)[N]["response"] extends z.ZodType
  ? z.infer<(typeof routes)[N]["response"]>
  : void;

/** Thrown for every non-2xx response; `body` is the contract ApiError. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error.message);
  }
  get code() {
    return this.body.error.code;
  }
}

export type SightlineApiOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Validate responses against the contract in development (default true). */
  validate?: boolean;
};

/** Typed REST client. Every method maps 1:1 to an entry in `routes` (src/api.ts). */
export function createSightlineApi(options: SightlineApiOptions) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  async function request<N extends RouteName>(
    name: N,
    init: { params?: Record<string, string>; query?: Record<string, string | number>; body?: unknown } = {},
  ): Promise<Infer<N>> {
    const route = routes[name];
    const qs = init.query
      ? `?${new URLSearchParams(Object.entries(init.query).map(([k, v]) => [k, String(v)]))}`
      : "";
    const isForm = init.body instanceof FormData;
    const res = await doFetch(`${base}${buildPath(route.path, init.params)}${qs}`, {
      method: route.method,
      credentials: "include",
      headers: init.body === undefined || isForm ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      const parsed = ApiError.safeParse(json);
      throw new ApiRequestError(
        res.status,
        parsed.success ? parsed.data : { error: { code: "INTERNAL", message: `HTTP ${res.status}` } },
      );
    }
    if (route.response === null || res.status === 204) return undefined as Infer<N>;
    const json = await res.json();
    if (options.validate === false) return json as Infer<N>;
    const parsed = route.response.safeParse(json);
    if (!parsed.success) console.warn(`[api] ${name} response does not match contract`, parsed.error.issues);
    return (parsed.success ? parsed.data : json) as Infer<N>;
  }

  const s = (sessionId: string) => ({ params: { sessionId } });

  return {
    health: () => request("health"),
    me: () => request("me"),

    listSessions: (page = 1, pageSize = 20) => request("listSessions", { query: { page, pageSize } }),
    createSession: (body: z.input<typeof CreateSessionInput>) => request("createSession", { body }),
    getSession: (sessionId: string) => request("getSession", s(sessionId)),
    updateSession: (sessionId: string, body: UpdateSessionInput) => request("updateSession", { ...s(sessionId), body }),
    deleteSession: (sessionId: string) => request("deleteSession", s(sessionId)),
    startSession: (sessionId: string) => request("startSession", s(sessionId)),
    endSession: (sessionId: string) => request("endSession", s(sessionId)),

    getContext: (sessionId: string) => request("getContext", s(sessionId)),
    setContextText: (sessionId: string, text: string) => request("setContextText", { ...s(sessionId), body: { text } }),
    uploadSlides: (sessionId: string, file: File) => {
      const body = new FormData();
      body.append("file", file);
      return request("uploadSlides", { ...s(sessionId), body });
    },
    getSlides: (sessionId: string) => request("getSlides", s(sessionId)),

    getTranscript: (sessionId: string) => request("getTranscript", s(sessionId)),
    createSignUtterance: (sessionId: string, body: z.input<typeof CreateSignUtteranceInput>) =>
      request("createSignUtterance", { ...s(sessionId), body }),
    listSignUtterances: (sessionId: string) => request("listSignUtterances", s(sessionId)),

    getNotes: (sessionId: string) => request("getNotes", s(sessionId)),
    regenerateNotes: (sessionId: string) => request("regenerateNotes", s(sessionId)),
    /** Absolute URL for an <a download> link. */
    notesExportUrl: (sessionId: string) => `${base}${buildPath(routes.exportNotes.path, { sessionId })}?format=md`,
  };
}

export type SightlineApi = ReturnType<typeof createSightlineApi>;
