FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup --system --gid 1001 farmrent \
 && adduser  --system --uid 1001 farmrent
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chown -R farmrent:farmrent /app
USER farmrent
ENV NODE_ENV=production
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s \
  CMD wget -qO- http://localhost:${PORT:-5000}/health || exit 1
CMD ["node", "server.js"]
