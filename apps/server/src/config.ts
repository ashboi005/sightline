import { ENV } from "./env.server";

const inherit = (override: boolean | undefined) => override ?? ENV.USE_MOCK_DATA;

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
