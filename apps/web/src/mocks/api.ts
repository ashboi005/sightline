import type { Paginated, Session } from "@/types";

import { mockSessions, mockUser } from "./data";

// Mock responses for `api()` when NEXT_PUBLIC_MOCK_MODE=true. Add a route here when you add a query hook.
const routes: Record<string, (body: unknown) => unknown> = {
  "GET /api/me": () => mockUser,
  "GET /api/sessions": (): Paginated<Session> => ({
    data: mockSessions,
    pagination: { page: 1, pageSize: 20, totalItems: mockSessions.length, totalPages: 1 },
  }),
};

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 400)); // feel like a network call, so loading states show
  const key = `${init?.method ?? "GET"} ${path.split("?")[0]}`;
  const handler = routes[key];
  if (!handler) throw new Error(`No mock for ${key}. Add one in src/mocks/api.ts`);
  return handler(init?.body ? JSON.parse(String(init.body)) : undefined) as T;
}
