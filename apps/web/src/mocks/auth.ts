import type { User } from "@/types";

import { mockUser } from "./data";

// Stand-in for better-auth when NEXT_PUBLIC_MOCK_MODE=true. Any email and password signs in.
// The signed-in user is kept in localStorage so it survives reloads, like a real session cookie.
const KEY = "sightline.mock-session";

const wait = () => new Promise((r) => setTimeout(r, 400));

function read(): User | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function write(user: User | null) {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked (private window): the session lasts until reload
  }
}

export const mockAuth = {
  async getSession() {
    await wait();
    const user = read();
    return user ? { user } : null;
  },
  async signIn(input: { email: string }) {
    await wait();
    write({ ...mockUser, email: input.email });
  },
  async signUp(input: { name: string; email: string }) {
    await wait();
    write({ ...mockUser, name: input.name, email: input.email });
  },
  async signOut() {
    await wait();
    write(null);
  },
};
