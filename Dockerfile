# Portable EdgeSpec runtime for Fly, Railway, Kubernetes and local Docker.
# Bun runs the TypeScript entry directly; only the dashboard needs a build.
FROM oven/bun:1.4-alpine

WORKDIR /app
COPY . .

RUN bun install --frozen-lockfile
RUN bun run build:web

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["bun", "packages/runtime/src/server.ts"]
