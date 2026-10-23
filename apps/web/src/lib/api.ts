import { ApiRequestError, createSightlineApi } from "@sightline/contracts/client";

import { SERVER_URL } from "./config";

/** The typed REST client from the contracts. Call it from TanStack Query hooks (src/hooks), not from components. */
export const api = createSightlineApi({ baseUrl: SERVER_URL });

export { ApiRequestError };

/**
 * Asset URLs as the browser should load them. Relative ones get this server's origin. Absolute `/api/assets/…` URLs
 * are re-pointed at this server too: another backend sharing the database (the deployed one) may have processed the
 * upload and written its own host, and assets need the sign-in cookie, which only this server's origin has.
 */
export function assetUrl(url: string) {
  if (url.startsWith("/")) return `${SERVER_URL}${url}`;
  try {
    const { pathname, search } = new URL(url);
    if (pathname.startsWith("/api/assets/")) return `${SERVER_URL}${pathname}${search}`;
  } catch {
    // not a URL: leave it alone
  }
  return url;
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
