# FarmRent — Farm Equipment Rental Platform

[![Render Deploy](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml/badge.svg?branch=audit/farmrent-refactor)](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml)
[![CI](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/ci.yml/badge.svg)](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/ci.yml)

> ### Live site — **<https://farmrentcom.in>**
>
> **Deploys from** [`.github/workflows/render-deploy.yml`](.github/workflows/render-deploy.yml) — every push to `audit/farmrent-refactor`
> runs the whole test suite first and reaches Render only if it passes.
> **Watch a release:** [Actions → Render Deploy](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml)
> · **Repository:** [Aravindreddykothuru/FarmRent](https://github.com/Aravindreddykothuru/FarmRent)

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

### On a phone

Most people who sign up arrive on an Android phone, often on a slow connection and often not reading
English, so the sign-in and registration screens are built for that reader first:

- Controls are at least 48px tall and body text at least 16px, so nothing needs zooming to read or a
  second try to tap. Checked in a real browser at 360px and 412px, with no horizontal scrolling.
- English, Telugu and Hindi sit at the top of both screens, one tap each; the other seven languages are
  behind **More languages** (`/select-language`). Someone who cannot read the page has to be able to
  change it before anything else on the page helps them.
- A **Need help? Call us** button dials the support number straight from the screen.
- Field errors appear underneath as an icon and plain words rather than fine red print.
- Registration shows which of its three phases you are in — your email, your details, done.

The app is installable: Android Chrome offers **Add to Home Screen** and then opens it without browser
chrome. The manifest is `nextfrontend/public/manifest.webmanifest`. Pinch-zoom is deliberately left
enabled, because capping it locks out anyone who needs to magnify.

### Signing in with a mobile number

Both auth screens take a mobile number as well as an email. Login offers **OTP on SMS** beside the
password, and registration lets a person prove themselves by **email or mobile**, whichever they can
use; either route creates the same account.

Codes are delivered by [2Factor.in](https://2factor.in). Its AUTOGEN flow generates, sends and checks
the code, so the server never holds an OTP and there is nothing to leak — the audit table has no column
that could store one, and logs carry a masked number (`98XXXXXX10`) and never the key or the code.

| Variable | What it does |
|---|---|
| `TWOFACTOR_API_KEY` | The 2Factor account key. Server-side only, never sent to a browser. Without it the phone endpoints fall back to the existing providers, which outside production ends at a code the server logs and returns as `devOtp` — so the whole flow is testable with no paid account. |
| `TWOFACTOR_TEMPLATE` | The DLT template name. Leave empty for 2Factor's default; set it to the registered "FarmRent" template once DLT approval arrives, with no code change. |

On Render both are set in the dashboard — `render.yaml` declares the key as `sync: false`, so it is
asked for there and never committed. Every `.env` file is already gitignored.

Limits, enforced per number and per address because each send costs a message: one code a minute,
five an hour per number, ten an hour per address, and three wrong guesses before the code is thrown
away. A verified signup returns a token that proves only that number, is single use and expires in ten
minutes; it is what step 3 exchanges for an account.

An email address is still required at signup: `users.email` is `NOT NULL` and the JWT is signed with
it, so a phone-only account would need a migration on the live users table and a change to token
signing. The number is proved by OTP; the address is not, and the account does not claim it is.

---

## Tech stack

| Layer | Technology |
|---|---|
| Web app | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui; installable as a PWA |
| API | Node.js 20, Express 4, Zod validation, Socket.IO 4 |
| Database | PostgreSQL 15 + PostGIS via PostgREST (Supabase-compatible); SQL migrations in `Backend_Node_legacy/db/migrations` |
| Cache / sessions | Redis 7 |
| Payments | Razorpay (optional) + cash on delivery |
| SMS OTP | 2Factor.in AUTOGEN (optional); falls back to the existing email/WhatsApp/SMS providers, and to a logged code outside production |
| Languages | 10 — English, Hindi, Telugu, Tamil, Kannada, Marathi, Punjabi, Bengali, Gujarati, Malayalam (`nextfrontend/messages/`) |
| Hosting | Render web service from `Dockerfile` (blueprint in `render.yaml`), Render Key Value for Redis, Supabase for Postgres |
| Tests | Jest + Supertest (unit, integration, API contract), HTTP acceptance script, Playwright-driven browser smoke |
| CI / CD | GitHub Actions — `ci.yml` (tests), `render-deploy.yml` (live site), `production-deploy.yml` (ECR/EKS image) |

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
  components/AuthAssist.tsx language chips and the "Need help?" button shared by the auth screens
  lib/contact.ts            support phone, email and location — the one place they are written down
  messages/                 UI strings, one file per language; i18n/config.ts lists the locales
  public/manifest.webmanifest, public/icons/   PWA manifest and icons (Add to Home Screen)
render.yaml                 Render blueprint: the web service and Redis that run the live site
```

Nothing else in the repository is part of the product: earlier prototypes (a Flask sidecar, a Spring Boot service, a separate Next.js app, a MongoDB backend) were never deployed and have been removed; they remain in git history.

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
| `npm --prefix nextfrontend run check:links` | every hard-coded internal link points at a page that exists (production prefetches links, so a dead one is a console 404) | — |

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

The live site runs on **Render** at **<https://farmrentcom.in>**.

- **[`.github/workflows/render-deploy.yml`](.github/workflows/render-deploy.yml) is what ships it.** A push to
  `audit/farmrent-refactor` runs the whole suite as a gate and calls the Render API only once it is green,
  pinned to the commit CI just proved rather than to whatever the branch tip has become. A red suite never
  reaches production, and every attempt leaves a run in
  [Actions](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml) whether it
  succeeded or not — which a browser-authorised Render connection does not. `workflow_dispatch` re-runs it
  by hand.
- **[`render.yaml`](render.yaml)** is the blueprint: one Docker web service and a Key Value (Redis) instance,
  with Postgres coming from a Supabase project created outside Render. Values marked `sync: false` are entered
  in the Render dashboard and never live in this repository.
- Build the image from `Dockerfile`. Browser-visible settings (`NEXT_PUBLIC_*`) are build arguments; server secrets are runtime environment variables and never enter the image (`.dockerignore` excludes every `.env` file).
- Required runtime variables: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REDIS_URL`, `APP_URL`, `ALLOWED_ORIGINS` (your real domains only), `CLIENT_URL`. Set `TRUST_PROXY=1` behind a load balancer so rate limits see client IPs.
- Apply database migrations deliberately before releasing code that needs them — back up first, then from `Backend_Node_legacy`: `DATABASE_URL=<production connection string> npm run migrate`. The runner records checksums in `schema_migrations`, takes an advisory lock and skips migrations that are already applied. The deploy workflow never migrates on its own.
- `.github/workflows/production-deploy.yml` is a separate path, triggered by a push to `main`: it runs the full CI, builds and pushes the image to ECR and rolls out to EKS. It does not serve farmrentcom.in.

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
| Auth by mobile | `POST /api/v1/auth/phone/send-otp` `{phone, purpose}`, `…/phone/verify-otp` `{phone, otp, purpose}` (login returns a session, signup returns a 10-minute signup token), `…/phone/register` `{signupToken, name, email, password, role, …}` |
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
