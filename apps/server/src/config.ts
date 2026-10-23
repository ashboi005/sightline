import { ENV } from "./env.server";

// An empty override inherits USE_MOCK_DATA. Hosts like Coolify pass unset variables as "" rather than leaving them
// out, which used to leak "" into the flags (and /api/health) instead of a boolean.
const inherit = (override: boolean | undefined) => (override === undefined || (override as unknown) === "" ? ENV.USE_MOCK_DATA : override === true || (override as unknown) === "true");

/** Resolved runtime configuration. Read flags from here, not from ENV directly. */
export const config = {
  port: ENV.PORT,
  publicUrl: ENV.PUBLIC_SERVER_URL.replace(/\/$/, ""),
  isProduction: ENV.NODE_ENV === "production",
  mocks: {
    // core — Ashwath
    captions: inherit(ENV.MOCK_CAPTIONS),
    speech: inherit(ENV.MOCK_SPEECH),
    // surrounding — Tushar
    knowledge: inherit(ENV.MOCK_KNOWLEDGE),
    notes: inherit(ENV.MOCK_NOTES),
    persistence: inherit(ENV.MOCK_PERSISTENCE),
    slides: inherit(ENV.MOCK_SLIDES),
    auth: inherit(ENV.MOCK_AUTH),
  },
  mockReplaySpeed: ENV.MOCK_REPLAY_SPEED > 0 ? ENV.MOCK_REPLAY_SPEED : 1,
  storageDir: ENV.STORAGE_DIR,
} as const;

export type AppConfig = typeof config;
