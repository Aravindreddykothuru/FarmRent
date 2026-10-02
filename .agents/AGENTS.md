# FarmRent — Workspace Agent Rules

## Project Overview

**FarmRent** is a farm equipment rental platform connecting farmers with equipment owners.
One process (`nextfrontend/server.js`) serves the Next.js pages, the Express REST API and Socket.IO on one port (3000).

### Stack at a Glance
| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui |
| Backend | Node.js 20, Express 4 (`Backend_Node_legacy/`) |
| Database | PostgreSQL + PostGIS behind PostgREST (Supabase-compatible); SQL migrations in `Backend_Node_legacy/db/migrations` |
| Auth | Custom JWT (access 15 min, httpOnly cookie) + rotating refresh token in Redis |
| Payments | Razorpay + cash on delivery |
| Real-time | Socket.IO: `/tracking` (booking rooms, GPS) and `/notifications` (per user) |
| Cache | Redis (sessions, rate limits, caches, BullMQ queues, Socket.IO adapter) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

---

## Directory Structure

```
farmers/
├── Backend_Node_legacy/        ← Express REST API (the only backend, despite the name)
│   ├── app.js                  ← Express app factory (no listen)
│   ├── services/               ← Feature routers (auth, booking, payment, tracking, …)
│   ├── routes/                 ← Shared routers (machines, messages, kyc, …)
│   ├── middleware/             ← auth, requireRole, errorHandler, rate limiters
│   ├── lib/                    ← logger, config, email, queues, metrics
│   ├── workers/                ← BullMQ workers (invoice, cron, image)
│   ├── db/                     ← migrate.js, migrations/, seed.js
│   └── __tests__/              ← unit + integration (incl. api-contract.test.js)
├── nextfrontend/               ← Next.js app and the unified server
│   ├── server.js               ← Entry point (dev and production)
│   ├── proxy.ts                ← Sign-in redirects for protected pages
│   └── scripts/                ← ui-smoke.mjs, check-links.cjs
├── infra/local/                ← Local stack bootstrap (PostgREST gateway, DB roles)
├── scripts/setup-local-env.js  ← Generates local env files with fresh secrets
├── docker-compose.yml          ← Local stack: Postgres/PostGIS, PostgREST, Redis (+ app profile)
└── Dockerfile                  ← Production image of the unified app
```

---

## Coding Conventions

### Backend (Node.js / Express)
- Use `lib/logger` (Pino) — never `console.log` in application code.
- Throw `HttpError(status, code, message)` (or call `next(err)`); `errorHandler` builds the response envelope.
- Authentication: `auth(true)` mandatory, `auth(false)` optional; role checks with `requireRole(...)`.
- Validate request bodies and queries with Zod schemas in `validations/schemas.js`.
- Business rules (prices, rental states, overlap checks) live on the server; never trust client amounts.
- Every new route needs a valid and an invalid request in `__tests__/integration/api-contract.test.js` — the suite fails otherwise.
- Schema changes are new numbered SQL files in `db/migrations`; never edit an applied migration.

### Frontend (Next.js)
- App Router only. API calls go through `lib/api.ts` (`nodeApi`) to `/api/v1` on the same origin.
- Real-time features use the Socket.IO helpers in `lib/socket.ts`; sockets authenticate with the session cookie.
- The browser never talks to the database directly.
- Translations live in `messages/*.json`; add keys to `en.json` at least.

### Environment Variables
- Backend/server env: `Backend_Node_legacy/.env` (or the file named by `FARMRENT_ENV_FILE`); see `.env.example`.
- **Never commit `.env` files** — only update `.env.example` files.

---

## Development Workflow

```bash
npm run setup:env      # generate local secrets
npm run stack:up       # Postgres, PostgREST gateway, Redis
npm run install:all
npm run migrate && npm run seed
npm run dev            # http://localhost:3000
npm test               # backend unit + integration (needs the stack)
npm run lint && npm run typecheck
```

---

## Common Gotchas

- **Webhook body parsing**: `/api/payment/webhook` skips `express.json()` so the Razorpay signature can be verified on the raw body.
- **Socket.IO** is attached to the unified server in `nextfrontend/server.js`.
- **Next.js public env**: anything prefixed `NEXT_PUBLIC_` is compiled into the browser bundle — never put a secret there.
