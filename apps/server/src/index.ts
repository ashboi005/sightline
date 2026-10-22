import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { config } from "./config";
import { createContainer } from "./container";
import { ENV } from "./env.server";
import { errorHandler } from "./lib/error-handler";
import { platformDevRoutes } from "./modules/platform/dev-routes";
import { seedDemoSession } from "./modules/platform/mock-seed";
import { platformRoutes } from "./modules/platform/routes";
import { LocalObjectStorage } from "./lib/storage";
import { localStorageRoutes } from "./lib/storage-routes";
import { recordingRoutes } from "./modules/recordings/routes";
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
  // surrounding (Tushar)
  .use(platformRoutes(c))
  // core (Ashwath)
  .use(c.live.routes)
  .use(c.live.socket)
  // recordings (owner TBD)
  .use(recordingRoutes(c));

// Local storage driver: this server plays the role of S3 for presigned URLs.
if (c.storage instanceof LocalObjectStorage) app.use(localStorageRoutes(c.storage));

if (!config.isProduction) app.use(c.live.devRoutes).use(platformDevRoutes(c.knowledge, c.notes));

app.listen({ port: config.port, maxRequestBodySize: 1024 * 1024 * 1024 }, () => {
  const flags = Object.entries(config.mocks)
    .map(([name, on]) => `${name}=${on ? "MOCK" : "real"}`)
    .join("  ");
  const engines = Object.entries(c.engines)
    .map(([name, impl]) => `${name}=${impl}`)
    .join(" ");
  console.log(`Server is running on http://localhost:${config.port}`);
  console.log(`  modules: ${flags}`);
  console.log(`  engines: ${engines}`);
});

if (config.mocks.persistence && config.mocks.auth) {
  seedDemoSession(c).catch((error) => console.error("[seed] failed", error));
}
