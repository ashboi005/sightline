FROM oven/bun:1.4.4 AS builder
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/server && bun run build

FROM oven/bun:1.4.4 AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils libreoffice-impress fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app /app

EXPOSE 3000

WORKDIR /app/apps/server
CMD ["bun", "dist/index.mjs"]
