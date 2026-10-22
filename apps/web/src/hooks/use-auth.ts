"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { CurrentUser } from "@sightline/contracts";

import { ApiRequestError, api } from "@/lib/api";
import { clearAccountState } from "@/lib/account-state";
import { authClient } from "@/lib/auth-client";
import { keys } from "@/lib/query-keys";

export type User = Pick<CurrentUser, "id" | "name" | "email"> & { isMock?: boolean };

export const authKeys = { session: keys.session };

export type AuthSession = { user: User } | null;

type AuthResult<T> = { data: T | null; error: { message?: string; statusText?: string } | null };

/** better-auth returns `{ data, error }` instead of throwing; TanStack Query needs a throw to mark failure. */
function unwrap<T>(result: AuthResult<T>): T {
  if (result.error) {
    throw new Error(result.error.message || result.error.statusText || "Something went wrong");
  }
  return result.data as T;
}

async function getSession(): Promise<AuthSession> {
  const data = unwrap(await authClient.getSession());
  if (data) return { user: { id: data.user.id, name: data.user.name, email: data.user.email } };
  // A server running with MOCK_AUTH treats every API call as its demo user, without a better-auth session.
  try {
    const me = await api.me();
    return me.isMock ? { user: me } : null;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

/** A different student may have been signed in on this browser: drop their cached data, then load the new session. */
function startFreshAccount(queryClient: QueryClient) {
  clearAccountState();
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
  return queryClient.invalidateQueries({ queryKey: authKeys.session });
}

export function useSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: getSession,
    staleTime: 5 * 60_000,
  });
}

export type SignInInput = { email: string; password: string };

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignInInput) => {
      unwrap(await authClient.signIn.email(input));
    },
    onSuccess: () => startFreshAccount(queryClient),
  });
}

export type SignUpInput = { name: string; email: string; password: string };

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignUpInput) => {
      unwrap(await authClient.signUp.email(input));
    },
    onSuccess: () => startFreshAccount(queryClient),
  });
}

/**
 * Signs out, then reloads the home page. The full load drops every socket, the mic and cameras, and all cached
 * data in one go, and avoids racing the workspace's "sign in to continue" redirect.
 */
export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      unwrap(await authClient.signOut());
    },
    onSuccess: () => {
      clearAccountState();
      window.location.replace("/");
    },
  });
}
