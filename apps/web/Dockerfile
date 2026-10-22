FROM node:24-slim AS builder
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install

# NEXT_PUBLIC_* are inlined at build time — set them as build args in Coolify.
ARG NEXT_PUBLIC_SERVER_URL
ARG NEXT_PUBLIC_SERVER_WS_URL
ARG NEXT_PUBLIC_GAZE_BRIDGE_URL=ws://localhost:7777
ARG NEXT_PUBLIC_SIGN_SERVICE_URL=ws://localhost:7788
ARG NEXT_PUBLIC_SPEAKER_SERVICE_URL=ws://127.0.0.1:7799/live
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
ENV NEXT_PUBLIC_SERVER_WS_URL=${NEXT_PUBLIC_SERVER_WS_URL}
ENV NEXT_PUBLIC_GAZE_BRIDGE_URL=${NEXT_PUBLIC_GAZE_BRIDGE_URL}
ENV NEXT_PUBLIC_SIGN_SERVICE_URL=${NEXT_PUBLIC_SIGN_SERVICE_URL}
ENV NEXT_PUBLIC_SPEAKER_SERVICE_URL=${NEXT_PUBLIC_SPEAKER_SERVICE_URL}
ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/web && bun run build && rm -f .next/standalone/.env* .next/standalone/apps/web/.env*
# standalone output excludes public/; ensure it exists so the runner copy never fails
RUN mkdir -p apps/web/public

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
# auto-load needs the Varlock CLI and its installed dependencies.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/.env.schema ./apps/web/.env.schema

ENV HOSTNAME=0.0.0.0
ENV PORT=3001
EXPOSE 3001

WORKDIR /app/apps/web
CMD ["node", "--import", "varlock/auto-load", "server.js"]
