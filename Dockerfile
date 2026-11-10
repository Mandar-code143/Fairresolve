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

# Install curl and gosu for healthcheck and safe non-root volume initialization
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gosu \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV FAIRRESOLVE_STORAGE_DIR=/app/data

# Copy package manifests, pruned production node_modules, compiled artifacts, and schema/migrations
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/server/database ./src/server/database
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Normalize line endings on entrypoint, prepare default dirs, and ensure permissions
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data/private_uploads \
    && chown -R node:node /app /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD sh -c "curl -fsS http://127.0.0.1:${PORT:-3000}/health/ready || exit 1"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
