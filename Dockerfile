# syntax=docker/dockerfile:1.7
# FarmRent unified application image: Next.js pages + Express API + Socket.IO on one port.
# Configuration (database, Redis, JWT secrets, payment keys) comes from the runtime environment;
# .dockerignore keeps every .env file out of the build context.
FROM node:20-alpine AS builder

WORKDIR /app

# The npm cache is mounted rather than baked in: it survives between builds (so a rebuild does not re-download
# the world) and never becomes part of a layer.
COPY Backend_Node_legacy/package.json Backend_Node_legacy/package-lock.json Backend_Node_legacy/.npmrc ./Backend_Node_legacy/
RUN --mount=type=cache,target=/root/.npm cd Backend_Node_legacy && npm ci --omit=dev --legacy-peer-deps

COPY nextfrontend/package.json nextfrontend/package-lock.json ./nextfrontend/
RUN --mount=type=cache,target=/root/.npm cd nextfrontend && npm ci --legacy-peer-deps

COPY Backend_Node_legacy ./Backend_Node_legacy
COPY nextfrontend ./nextfrontend

# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are build arguments.
ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
RUN cd nextfrontend && npm run build

# Building needs TypeScript, Tailwind, ESLint and Playwright; serving the built app needs none of them. The
# build cache is a local artefact and is never read from the image.
RUN cd nextfrontend \
    && npm prune --omit=dev --legacy-peer-deps \
    && rm -rf .next/cache

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=node:node /app/Backend_Node_legacy ./Backend_Node_legacy
COPY --from=builder --chown=node:node /app/nextfrontend ./nextfrontend
RUN mkdir -p Backend_Node_legacy/uploads && chown node:node Backend_Node_legacy/uploads

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "nextfrontend/server.js"]
