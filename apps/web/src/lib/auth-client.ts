import { createAuthClient } from "better-auth/react";

function getServerUrl(url: string | undefined) {
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  const serverUrl =
    typeof window === "undefined"
      ? processEnv?.SERVER_URL || url
      : url;
  const normalizedUrl = serverUrl || "http://localhost:3000";

  return normalizedUrl.endsWith("/")
    ? normalizedUrl.slice(0, -1)
    : normalizedUrl;
}

export const authClient = createAuthClient({
  baseURL: new URL("/api/auth", getServerUrl(process.env.NEXT_PUBLIC_SERVER_URL)).toString(),
});
