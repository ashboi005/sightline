import { drizzle } from "drizzle-orm/node-postgres";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  return drizzle({
    connection: {
      connectionString: env.DATABASE_URL,
      // A transaction left open by a crashed/killed process must not hold locks forever. Behind a TCP proxy
      // (Coolify's public Postgres port) the server never sees the client disconnect, so an orphaned job claim
      // kept the claim lock and stalled every background job until it was killed by hand.
      idle_in_transaction_session_timeout: 30_000,
      keepAlive: true,
      connectionTimeoutMillis: 10_000,
    },
    relations,
  });
}

export type Database = ReturnType<typeof createDb>;
