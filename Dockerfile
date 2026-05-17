# ── Stage 1: install Backend deps ────────────────────────────────────────────
FROM node:20-alpine AS backend-deps
WORKDIR /app/Backend
COPY Backend/package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: install Frontend deps + build Next.js ───────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Copy Backend (needed at build time because server.js imports it)
COPY Backend/ ./Backend/
COPY --from=backend-deps /app/Backend/node_modules ./Backend/node_modules

# Install ALL frontend deps (TypeScript, postcss etc. needed for build)
COPY nextfrontend/package*.json ./nextfrontend/
RUN cd nextfrontend && npm ci

# Copy frontend source and build
COPY nextfrontend/ ./nextfrontend/
RUN cd nextfrontend && npm run build

# ── Stage 3: production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Backend (production deps already pruned)
COPY --from=frontend-builder /app/Backend/ ./Backend/

# Frontend: compiled .next + source + node_modules (prune dev)
COPY --from=frontend-builder /app/nextfrontend/ ./nextfrontend/
RUN cd nextfrontend && npm prune --omit=dev || true

EXPOSE 3000

# Run unified server directly (avoids needing cross-env devDep)
CMD ["node", "nextfrontend/server.js"]
