// Where the web app finds the server and the services on the student's laptop (apps/web/.env).
// For development run the server with USE_MOCK_DATA=true and the device mocks from packages/mocks
// (`bun run mock:gaze`, `mock:sign`, `mock:speaker`); the app itself always talks to the real protocols.

const trim = (url: string) => url.replace(/\/$/, "");

export const SERVER_URL = trim(process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000");
export const SERVER_WS_URL = trim(process.env.NEXT_PUBLIC_SERVER_WS_URL || "ws://localhost:3000");
export const GAZE_BRIDGE_URL = process.env.NEXT_PUBLIC_GAZE_BRIDGE_URL || "ws://localhost:7777";
export const SIGN_SERVICE_URL = process.env.NEXT_PUBLIC_SIGN_SERVICE_URL || "ws://localhost:7788/ws";
export const SPEAKER_SERVICE_URL = process.env.NEXT_PUBLIC_SPEAKER_SERVICE_URL || "ws://127.0.0.1:7799/live";

/** The speaker service's health endpoint lives next to its WebSocket: ws://host:port/live → http://host:port/health. */
export const SPEAKER_HEALTH_URL = SPEAKER_SERVICE_URL.replace(/^ws/, "http").replace(/\/live$/, "/health");
