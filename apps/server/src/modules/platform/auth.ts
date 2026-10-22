/**
 * OWNER: Tushar. Resolves the signed-in user for /api and /ws routes. MOCK_AUTH=true → fixed demo user.
 */
import type { createAuth } from "@sightline/auth";
import type { CurrentUser } from "@sightline/contracts";

import { AppError } from "../../lib/errors";

export const DEMO_USER: CurrentUser = {
  id: "usr_demo",
  name: "Demo Student",
  email: "demo@sightline.dev",
  isMock: true,
};

export type UserResolver = (request: Request) => Promise<CurrentUser>;

export function createUserResolver(opts: { mock: boolean; auth: ReturnType<typeof createAuth> }): UserResolver {
  return async (request) => {
    if (opts.mock) return DEMO_USER;
    const result = await opts.auth.api.getSession({ headers: request.headers });
    if (!result) throw new AppError("UNAUTHORIZED", "Sign in required");
    return { id: result.user.id, name: result.user.name, email: result.user.email, isMock: false };
  };
}
