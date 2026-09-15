# FarmRent — Farm Equipment Rental Platform

FarmRent connects farmers who need machinery (tractors, harvesters, sprayers, threshers) with owners who rent it out. Owners list equipment with a daily rate, deposit and pickup point; renters request dates; owners confirm, hand over and close the rental with a code the renter shows them. Payments are cash on delivery or Razorpay.

---

## Architecture

```
Browser (Next.js pages, Socket.IO client)
        │  one origin, one port (3000)
        ▼
┌──────────────────────────────────────────────────────────────┐
│  Unified server — nextfrontend/server.js                     │
│    /api/v1/*, /api/payment/*, /health, /metrics → Express    │
│    /socket.io  (namespaces /tracking, /notifications)        │
│    everything else → Next.js App Router                      │
└───────────────┬──────────────────────────────┬───────────────┘
                │ supabase-js (service role)   │
                ▼                              ▼
     PostgREST (Supabase, or the local        Redis
     gateway on :54321) → Postgres + PostGIS  sessions, refresh tokens,
     RLS on every table; only the API's       rate limits, caches, queues,
     service role can read or write           Socket.IO adapter
```

- **One process** serves pages, the REST API and websockets, so the browser never needs a separate API URL.
- **Business rules live on the server**: prices are computed from the listing (the client's amounts are ignored), the rental state machine is enforced by conditional updates, and a Postgres exclusion constraint makes double-booking impossible even under concurrent requests.
- **Auth**: short-lived JWT access token (15 min) in an httpOnly cookie, rotating refresh token stored hashed in Redis with reuse detection, server-side session list with remote sign-out.

### Rental lifecycle

| Action | From | To | Who |
|---|---|---|---|
| request | — | `requested` (shown as *pending*) | renter |
| accept | requested | `approved` (*confirmed*) | owner, admin |
| reject | requested | `rejected` | owner, admin |
| cancel | requested, approved | `cancelled` | renter, owner, admin |
| start (hand over) | approved | `active` (*in progress*) | owner, driver, admin |
| return | active | `return_pending` | renter |
| complete | active, return_pending | `completed` | owner or driver with the renter's 6-digit completion code; admin |

Requests, confirmed and active rentals block their dates; an overlapping request is refused with `409 BOOKING_CONFLICT`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Web app | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui |
| API | Node.js 20, Express 4, Zod validation, Socket.IO 4 |
| Database | PostgreSQL 15 + PostGIS via PostgREST (Supabase-compatible); SQL migrations in `Backend_Node_legacy/db/migrations` |
| Cache / sessions | Redis 7 |
| Payments | Razorpay (optional) + cash on delivery |
| Tests | Jest + Supertest (unit, integration, API contract), HTTP acceptance script, Playwright-driven browser smoke |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

---

## Repository layout

```
docker-compose.yml          local stack: Postgres/PostGIS, PostgREST + gateway, Redis (+ app profile)
Dockerfile                  production image of the unified app
scripts/setup-local-env.js  generates local env files with fresh secrets
infra/local/                gateway config and database role bootstrap for the local stack
Backend_Node_legacy/        Express API
  app.js                    routes, security middleware, rate limits
  services/ routes/         feature routers (bookings, payments, machines, auth, …)
  db/migrate.js             migration runner (checksummed, idempotent)
  db/migrations/            SQL schema
  db/seed.js                demo data (refuses to run in production)
  __tests__/                unit + integration tests, incl. api-contract.test.js
  scripts/e2e-acceptance.js end-to-end acceptance run over HTTP
nextfrontend/               Next.js app and the unified server
  server.js                 entry point (dev and production)
  proxy.ts                  sign-in redirects for protected pages
  scripts/ui-smoke.mjs      browser smoke test
```

Other top-level folders (`frontend/`, `agronexus-springboot/`, `FutureEnhancement/`, `GPS/`) are experiments that are not part of the running application.

---

## Run it locally

Prerequisites: **Node.js 20+** and **Docker** with Compose v2.

```bash
# 1. Generate local secrets: .env (Docker stack) and Backend_Node_legacy/.env (app)
npm run setup:env

# 2. Start Postgres, the PostgREST gateway and Redis
npm run stack:up

# 3. Install dependencies
npm run install:all

# 4. Create the schema and load demo data
npm run migrate
npm run seed

# 5. Start the app (pages + API + websockets)
npm run dev
```

Open http://localhost:3000. Host ports default to 55432 (Postgres), 54321 (gateway), 6380 (Redis) and 3000 (app); change them in `.env` if they clash with something else.

**Demo accounts** (created by `npm run seed`, development only; password `FarmRent@2026` unless `SEED_PASSWORD` is set):

| Role | Email |
|---|---|
| Admin | admin@farmrent.local |
| Owner | owner1@farmrent.local, owner2@farmrent.local |
| Renter | farmer1@farmrent.local, farmer2@farmrent.local |

In development, registration and login OTPs are returned in the API response (`devOtp`) and logged by the server, and every email the app sends can be read at http://localhost:3000/dev/emails. Neither happens in production.

---

## Tests

| Command | What it checks | Needs |
|---|---|---|
| `npm run test:unit` | pricing, rental state machine, validation schemas | nothing |
| `npm run test:integration` | auth (register, login, refresh rotation, logout, rate limits), bookings (overlaps, lifecycle), listings, and `api-contract.test.js`: every mounted route called with a valid and an invalid request, failing if a route has no check | local stack, migrated |
| `npm test` | both of the above | local stack |
| `npm run test:e2e` | the full rental journey over HTTP: register, list, search, quote, request, overlap refusal, confirm, hand over, return, complete, history, logout, admin | app running in development mode on :3000, seeded |
| `npm run test:ui` | every page in Chrome as visitor, renter, owner and admin (console errors, failed requests, redirects), the rental journey through the UI, phone-width layout, sign-out | app running on :3000, seeded, Chrome or Edge installed |
| `npm run lint` / `npm run typecheck` | ESLint for both apps, TypeScript for the web app | — |

The integration tests refuse to run against a non-local database.

---

## Production build

```bash
npm run build
npm start
```

`npm start` runs the unified server with `NODE_ENV=production` on port 3000 (`PORT` overrides it). It reads configuration from `Backend_Node_legacy/.env` or the file named by `FARMRENT_ENV_FILE`.

Everything in containers, against the local stack:

```bash
docker compose --profile app up --build
```

### Deploying

- Build the image from `Dockerfile`. Browser-visible settings (`NEXT_PUBLIC_*`) are build arguments; server secrets are runtime environment variables and never enter the image (`.dockerignore` excludes every `.env` file).
- Required runtime variables: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REDIS_URL`, `APP_URL`, `ALLOWED_ORIGINS` (your real domains only), `CLIENT_URL`. Set `TRUST_PROXY=1` behind a load balancer so rate limits see client IPs.
- Apply database migrations deliberately before releasing code that needs them — back up first, then from `Backend_Node_legacy`: `DATABASE_URL=<production connection string> npm run migrate`. The runner records checksums in `schema_migrations`, takes an advisory lock and skips migrations that are already applied. The deploy workflow never migrates on its own.
- `.github/workflows/production-deploy.yml` runs the full CI, builds and pushes the image to ECR and rolls out to EKS.

---

## Configuration

| File | Used by |
|---|---|
| `.env.example` | Docker Compose (local stack ports and secrets) |
| `Backend_Node_legacy/.env.example` | the app and backend scripts — every server setting, with what is required and what each optional integration does without configuration |
| `nextfrontend/.env.example` | optional web-build overrides (`NEXT_PUBLIC_*`) |

---

## API

All JSON responses share one envelope:

```json
{ "success": true, "data": { }, "error": null, "timestamp": "…", "requestId": "…" }
```

Errors carry `error.code` (for example `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `BOOKING_CONFLICT`, `INVALID_TRANSITION`) and a readable `error.message`.

| Area | Main endpoints |
|---|---|
| Auth | `POST /api/v1/auth/reg-email-send-otp`, `…/reg-email-verify-otp`, `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `GET /api/v1/auth/sessions`, password reset |
| Listings | `GET /api/v1/machines`, `GET /api/v1/machines/:id`, `GET /api/v1/machines/nearby`, `POST/PATCH/DELETE /api/v1/machines/:id` (owner), `GET /api/v1/search/*` |
| Bookings | `GET /api/v1/bookings/quote`, `POST /api/v1/bookings`, `GET /api/v1/bookings/my`, `GET /api/v1/bookings/incoming`, `GET /api/v1/bookings/:id`, `PATCH …/accept \| reject \| cancel \| start`, `POST …/return`, `POST …/complete`, extensions, availability |
| Payments | `POST /api/payment/create-order`, `POST /api/payment/verify`, `POST /api/payment/webhook`, refunds |
| People & trust | profile, addresses, KYC, reviews, favorites, offers, chats, disputes, notifications |
| Tracking | Socket.IO `/tracking` rooms (booking parties only), `GET /api/v1/tracking/booking/:id/*` |
| Admin | `GET /api/v1/admin/dashboard`, users, bookings, listing moderation (`PATCH /api/v1/admin/machines/:id/approve \| reject`) |
| Public | `GET /api/v1/stats` (landing-page totals), `GET /health`, `GET /health/full` |

The executable reference is `Backend_Node_legacy/__tests__/integration/api-contract.test.js`; interactive docs are served at `/api-docs`.

Rate limits: credential endpoints (login, register, password reset, OTP) 20 requests per 15 minutes per IP and path; everything else 120 per minute per path; booking requests 3 per minute per user.

---

## Troubleshooting

- **Port already in use** — another Postgres or Redis on the default ports: set `DB_PORT`, `REDIS_PORT`, `SUPABASE_GATEWAY_PORT` or `APP_PORT` in `.env`, then re-run `npm run setup:env -- --force` so the app's env file matches.
- **`EPERM` on `.next` during a build on Windows** — a sync client (for example OneDrive) is holding files: delete `nextfrontend/.next` and build again.
- **Peer dependency errors on install** — install with `--legacy-peer-deps` (the `install:all` script does).

## License

MIT
