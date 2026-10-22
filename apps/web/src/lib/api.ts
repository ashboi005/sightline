import { createSightlineApi } from "@sightline/contracts/client";

/** Typed REST client for the Sightline server. Call it from TanStack Query hooks, not directly from components. */
export const api = createSightlineApi({
  baseUrl: process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000",
});
