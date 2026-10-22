import type { Paginated, Session } from "@/types";
import type { CaptionSegment, SignToken, SignUtterance } from "@/types/realtime";

import { mockSessions, mockUser } from "./data";

type Handler = (ctx: { params: Record<string, string>; body: unknown }) => unknown;

// Gloss phrase → the sentence the server's sign model would write.
const SENTENCES: Record<string, string> = {
  "PLEASE REPEAT FORMULA": "Could you please repeat the formula?",
  "WHAT MEAN KVL": "What does KVL mean?",
  "SLOW PLEASE": "Could you slow down, please?",
};

// Mock responses for `api()` when NEXT_PUBLIC_MOCK_MODE=true. Add a route here when you add a query hook.
// `:name` segments match anything and arrive in `params`.
const routes: Record<string, Handler> = {
  "GET /api/me": () => mockUser,
  "GET /api/sessions": (): Paginated<Session> => ({
    data: mockSessions,
    pagination: { page: 1, pageSize: 20, totalItems: mockSessions.length, totalPages: 1 },
  }),
  // The mock lecture socket streams every caption itself, so there's nothing to backfill.
  "GET /api/sessions/:sessionId/transcript": (): { data: CaptionSegment[] } => ({ data: [] }),
  "POST /api/sessions/:sessionId/sign/utterances": ({ params, body }): SignUtterance => {
    const { tokens, source } = body as { tokens: SignToken[]; source: SignUtterance["source"] };
    const gloss = tokens.map((t) => t.gloss);
    return {
      id: `utt_mock_${Date.now()}`,
      sessionId: params.sessionId!,
      source,
      gloss,
      text: SENTENCES[gloss.join(" ")] ?? `${gloss.join(" ").toLowerCase()}.`,
      alternatives: [],
      audioUrl: null,
      confidence: 0.9,
      createdAt: Date.now(),
    };
  },
};

function match(method: string, path: string) {
  const parts = path.split("/");
  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = key.split(" ");
    const routeParts = routePath!.split("/");
    if (routeMethod !== method || routeParts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = routeParts.every((p, i) => {
      if (!p.startsWith(":")) return p === parts[i];
      params[p.slice(1)] = decodeURIComponent(parts[i]!);
      return true;
    });
    if (ok) return { handler, params };
  }
  return null;
}

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 400)); // feel like a network call, so loading states show
  const method = init?.method ?? "GET";
  const found = match(method, path.split("?")[0]!);
  if (!found) throw new Error(`No mock for ${method} ${path}. Add one in src/mocks/api.ts`);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  return found.handler({ params: found.params, body }) as T;
}
