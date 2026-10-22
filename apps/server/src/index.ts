import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { config } from "./config";
import { createContainer } from "./container";
import { ENV } from "./env.server";
import { errorHandler } from "./lib/error-handler";
import { intelligenceDevRoutes } from "./modules/intelligence";
import { seedDemoSession } from "./modules/platform/mock-seed";
import { sessionSocket } from "./modules/platform/realtime/socket";
import { platformRoutes } from "./modules/platform/routes";
import { auth } from "./services";

const c = createContainer();

const app = new Elysia()
  .use(
    cors({
      origin: ENV.CORS_ORIGIN,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  .use(errorHandler)
  .all("/api/auth/*", async (context) => {
    const { request, status } = context;
    if (["POST", "GET"].includes(request.method)) {
      return auth.handler(request);
    }
    return status(405);
  })
  .get("/", () => "OK")
  .use(platformRoutes(c))
  .use(sessionSocket(c));

if (!config.isProduction) app.use(intelligenceDevRoutes(c.intelligence));

app.listen(config.port, () => {
  const flags = Object.entries(config.mocks)
    .map(([name, on]) => `${name}=${on ? "MOCK" : "real"}`)
    .join("  ");
  console.log(`Server is running on http://localhost:${config.port}`);
  console.log(`  modules: ${flags}`);
  console.log(`  engines: intelligence=${c.intelligence.name} stt=${c.stt.name} tts=${c.tts.name} store=${c.store.name}`);
});

if (config.mocks.persistence && config.mocks.auth) {
  seedDemoSession(c).catch((error) => console.error("[seed] failed", error));
}
