# Multi-stage production Dockerfile for FairResolve
FROM node:22-slim AS builder

WORKDIR /app

# Install build essentials for native modules (sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@10

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./

# Install all dependencies for build
RUN pnpm install --frozen-lockfile

# Copy application source files
COPY . .

# Build Vite frontend and compile Node server to dist/server.js
RUN pnpm run build

# Prune development dependencies so only production node_modules remain
RUN pnpm prune --prod

# -------------------------------------------------------------
# Production Runner Image
# -------------------------------------------------------------
FROM node:22-slim AS runner

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests, pruned production node_modules, compiled artifacts, and schema
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/server/database/schema.sql ./src/server/database/schema.sql

# Create non-volatile data directories and set permissions for non-root node user
RUN mkdir -p /app/data /app/private_uploads /data && chown -R node:node /app /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["node", "dist/server.js"]
