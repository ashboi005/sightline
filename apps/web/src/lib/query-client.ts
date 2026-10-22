import { QueryClient } from "@tanstack/react-query";

/**
 * TanStack Query setup. Every server call goes through a hook in src/hooks that uses this client:
 * useQuery for reads, useMutation for writes. Query keys live next to their hook.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // reuse data for 30s before refetching
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
