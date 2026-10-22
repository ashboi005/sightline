import { ApiRequestError, createSightlineApi } from "@sightline/contracts/client";

import { SERVER_URL } from "./config";

/** The typed REST client from the contracts. Call it from TanStack Query hooks (src/hooks), not from components. */
export const api = createSightlineApi({ baseUrl: SERVER_URL });

export { ApiRequestError };

/** Server URLs can be relative (`/api/assets/…`); media elements need them absolute. */
export function assetUrl(url: string) {
  return url.startsWith("/") ? `${SERVER_URL}${url}` : url;
}

/** A sentence for an error, for toasts and inline alerts. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "Your sign-in has expired. Sign in again to continue.";
    return error.message;
  }
  if (error instanceof TypeError) return "Can't reach the Sightline server. Check that it's running and try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
