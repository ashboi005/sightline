"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CurrentUser } from "@sightline/contracts";

import { ApiRequestError, api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export type User = Pick<CurrentUser, "id" | "name" | "email"> & { isMock?: boolean };

export const authKeys = {
  session: ["auth", "session"] as const,
};

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session }),
  });
}

export type SignUpInput = { name: string; email: string; password: string };

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignUpInput) => {
      unwrap(await authClient.signUp.email(input));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      unwrap(await authClient.signOut());
    },
    onSuccess: () => {
      queryClient.setQueryData(authKeys.session, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    },
  });
}
