"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";

export const authKeys = {
  session: ["auth", "session"] as const,
};

type AuthResult<T> = { data: T | null; error: { message?: string; statusText?: string } | null };

/** better-auth returns `{ data, error }` instead of throwing; TanStack Query needs a throw to mark failure. */
function unwrap<T>(result: AuthResult<T>): T {
  if (result.error) {
    throw new Error(result.error.message || result.error.statusText || "Something went wrong");
  }
  return result.data as T;
}

export function useSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: async () => unwrap(await authClient.getSession()),
    staleTime: 5 * 60_000,
  });
}

export type SignInInput = { email: string; password: string; rememberMe?: boolean };

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignInInput) => unwrap(await authClient.signIn.email(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session }),
  });
}

export type SignUpInput = { name: string; email: string; password: string };

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignUpInput) => unwrap(await authClient.signUp.email(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await authClient.signOut()),
    onSuccess: () => {
      queryClient.setQueryData(authKeys.session, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    },
  });
}
