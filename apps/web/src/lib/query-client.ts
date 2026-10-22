import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiRequestError } from "./api";
import { keys } from "./query-keys";

/**
 * TanStack Query setup. Every server call goes through a hook in src/hooks that uses this client:
 * useQuery for reads, useMutation for writes. Query keys live in lib/query-keys.ts.
 *
 * Any 401 from the API means the sign-in has expired: re-check the session, and the workspace's auth gate sends
 * the student to sign in (and back here afterwards).
 */
export function makeQueryClient() {
  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 401) void client.invalidateQueries({ queryKey: keys.session });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000, // reuse data for 30s before refetching
        refetchOnWindowFocus: false,
        // A 401 won't fix itself by retrying.
        retry: (count, error) => !(error instanceof ApiRequestError && error.status === 401) && count < 1,
      },
    },
  });
  return client;
}
