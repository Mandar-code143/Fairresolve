# Multi-stage production Dockerfile for FairResolve
FROM node:22-slim AS builder

WORKDIR /app

# Install build essentials for native modules (sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency manifests
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies including devDependencies for build
RUN pnpm install --frozen-lockfile || pnpm install

# Copy application source files
COPY . .

# Build Vite frontend for production
RUN pnpm run build

# -------------------------------------------------------------
# Production Runner Image
# -------------------------------------------------------------
FROM node:22-slim AS runner

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests and production dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# Copy compiled frontend dist and server assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create non-volatile data directories and adjust ownership
RUN mkdir -p /app/data /app/private_uploads && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["npx", "tsx", "server.ts"]
