import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@sightline/db";
import * as schema from "@sightline/db/schema/auth";
import { betterAuth } from "better-auth";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  /**
   * Parent domain shared by the web app and the API in production (e.g. "sightline.app" for
   * sightline.app + api.sightline.app). Without it the session cookie stays on the API host and the web app's
   * server-side session checks (dashboard) never see it. Leave empty for localhost.
   */
  AUTH_COOKIE_DOMAIN?: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      ...(env.AUTH_COOKIE_DOMAIN
        ? { crossSubDomainCookies: { enabled: true, domain: env.AUTH_COOKIE_DOMAIN.replace(/^\./, "") } }
        : {}),
      defaultCookieAttributes: {
        sameSite: env.BETTER_AUTH_URL.startsWith("https:") ? "none" : "lax",
        secure: env.BETTER_AUTH_URL.startsWith("https:"),
        httpOnly: true,
      },
    },
    plugins: [],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
