import { mockApi } from "@/mocks/api";

export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === "true";
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000";

/** GET/POST to the Sightline server with the session cookie. In mock mode it never touches the network. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (MOCK_MODE) return mockApi<T>(path, init);

  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
