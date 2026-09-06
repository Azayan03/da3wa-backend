# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: Build & Compile
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g npm@11

WORKDIR /app

COPY package*.json ./
# Use BuildKit cache mount to preserve downloaded tarballs across runs
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: Production Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Run as non-root user
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["node", "dist/server.js"]