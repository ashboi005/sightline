"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MOCK_MODE } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { mockAuth } from "@/mocks/auth";
import type { User } from "@/types";

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
  if (MOCK_MODE) return mockAuth.getSession();
  const data = unwrap(await authClient.getSession());
  return data ? { user: { id: data.user.id, name: data.user.name, email: data.user.email } } : null;
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
      if (MOCK_MODE) return mockAuth.signIn(input);
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
      if (MOCK_MODE) return mockAuth.signUp(input);
      unwrap(await authClient.signUp.email(input));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (MOCK_MODE) return mockAuth.signOut();
      unwrap(await authClient.signOut());
    },
    onSuccess: () => {
      queryClient.setQueryData(authKeys.session, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    },
  });
}
