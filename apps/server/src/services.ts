import { createAuth } from "@sightline/auth";
import { createDb } from "@sightline/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
