# FarmRent — Farm Equipment Rental Platform

[![Render Deploy](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml/badge.svg?branch=audit/farmrent-refactor)](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml)
[![CI](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/ci.yml/badge.svg)](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/ci.yml)

> ### Live site — **<https://farmrentcom.in>**
>
> **Render host:** **<https://farmrent-l9gk.onrender.com>** · **API Health:** [`/health`](https://farmrentcom.in/health) · **API Docs:** [`/api-docs`](https://farmrentcom.in/api-docs)
>
> **Deploys from** [`.github/workflows/render-deploy.yml`](.github/workflows/render-deploy.yml) — every push to `audit/farmrent-refactor`
> runs the whole test suite first and reaches Render only if it passes.
> **Watch a release:** [Actions → Render Deploy](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml)
> · **Repository:** [Aravindreddykothuru/FarmRent](https://github.com/Aravindreddykothuru/FarmRent)

FarmRent connects farmers who need machinery (tractors, harvesters, sprayers, threshers) with owners who rent it out. Owners list equipment with a daily rate, deposit and pickup point; renters request dates; owners confirm, hand over and close the rental with a code the renter shows them. Payments are cash on delivery or Razorpay.

---

## Architecture

```
Browser / PWA (Next.js 16 App Router, React 19, Socket.IO client)
        │
        │  One origin, one port (3000)
        ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Unified Server — nextfrontend/server.js                               │
│    ├── Express 4 API: /api/v1/*, /api/payment/*, /health, /metrics     │
│    ├── Socket.IO 4: /tracking (GPS coordinates), /notifications (push) │
│    └── Next.js 16 SSR & App Router: pages, layouts, server components  │
└────────┬───────────────────────────┬──────────────────────────┬────────┘
         │                           │                          │
         ▼                           ▼                          ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  PostgREST / DB  │       │  Redis 7 Cache   │       │ External APIs    │
│  Supabase        │       │  Render KeyValue │       │                  │
│  PostgreSQL 15   │       │  • Sessions      │       │  • 2Factor.in    │
│  + PostGIS       │       │  • Refresh tokens│       │    (SMS OTP)     │
│  • RLS on tables │       │  • Rate limits   │       │  • MSG91 / SMTP  │
│  • GiST ranges   │       │  • BullMQ queues │       │    (Email queue) │
│    prevent       │       │  • Socket.IO     │       │  • Razorpay      │
│    double-book   │       │    adapter       │       │    (Payments)    │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

- **One process**: Next.js App Router, Express REST API, and Socket.IO real-time servers run together in one process (`nextfrontend/server.js`) on port 3000. The browser never deals with cross-origin requests, port fragmentation, or disparate API hosts.
- **Business rules live on the server**: prices are computed from the listing (the client's amounts are ignored), the rental state machine is enforced by conditional updates, and a Postgres exclusion constraint makes double-booking impossible even under concurrent requests.
- **Auth**: short-lived JWT access token (15 min) in an httpOnly cookie, rotating refresh token stored hashed in Redis with reuse detection, server-side session list with remote sign-out.
- **Real-time telemetry**: Socket.IO `/tracking` namespace for booking-scoped GPS coordinates and live breadcrumbs, and `/notifications` for push updates.
- **Resilient messaging & fallbacks**: Phone OTP verification through 2Factor.in AUTOGEN (falling back to logged OTP in dev environments). Email transmission via dual-provider failover: MSG91 primary, Gmail SMTP secondary.

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
| Hosting | Render web service from `Dockerfile` (blueprint in `render.yaml`), Render Key Value for Redis, Supabase for Postgres (live at <https://farmrentcom.in> & <https://farmrent-l9gk.onrender.com>) |
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

## Deployment (Render)

The production stack is deployed on **Render** (migrated away from Railway), backed by **Render Key Value (Redis 7)** and **Supabase (PostgreSQL 15 + PostGIS)**.

### Live Host Links & Monitoring

| Endpoint | URL | Notes |
|---|---|---|
| **Production Domain** | **<https://farmrentcom.in>** | Primary custom domain with SSL |
| **Render Host URL** | **<https://farmrent-l9gk.onrender.com>** | Direct Render service domain (fallback & direct health check) |
| **API Health Check** | <https://farmrentcom.in/health> | Liveness endpoint checked every 30s by Render |
| **Deep Health Check** | <https://farmrentcom.in/health/full> | Diagnostic check verifying database and Redis connectivity |
| **API Documentation** | <https://farmrentcom.in/api-docs> | Interactive Swagger / OpenAPI documentation |
| **Release Monitor** | [Actions → Render Deploy](https://github.com/Aravindreddykothuru/FarmRent/actions/workflows/render-deploy.yml) | Gated CI/CD releases |

---

### Render Architecture Overview

```
                                  Render Cloud (Singapore)
                     ┌──────────────────────────────────────────────────┐
                     │                                                  │
Internet / Users ───►│  Render Reverse Proxy (TLS / Edge)               │
                     │         │                                        │
                     │         │ TRUST_PROXY=1 (Preserves client IP)    │
                     │         ▼                                        │
                     │  Web Service: farmrent                           │
                     │  (Docker runtime from root Dockerfile)           │
                     │  Next.js 16 SSR + Express API + Socket.IO (:3000)│
                     │         │                      │                 │
                     │         ▼                      │                 │
                     │  Key Value: farmrent-redis     │                 │
                     │  (Redis 7, maxmemory noevict)  │                 │
                     └────────────────────────────────┼─────────────────┘
                                                      │ IPv4 Session Pooler (:5432)
                                                      ▼
                                         External Supabase Project
                                         (PostgreSQL 15 + PostGIS)
```

1. **Web Service (`farmrent`)**:
   - Containerized deployment built from the root `Dockerfile`.
   - Single unified process on port 3000 running Next.js App Router, Express API (`/api/v1`), and Socket.IO real-time telemetry (`/tracking` and `/notifications`).
   - Sits behind Render's reverse proxy with `TRUST_PROXY=1` enabled so per-IP rate limiters accurately identify clients rather than collapsing all users into Render's shared proxy IP.
2. **Key Value Service (`farmrent-redis`)**:
   - Managed Redis 7 instance provisioned within the same Render region (Singapore).
   - Configured with `maxmemoryPolicy: noeviction` so the BullMQ email and notification queue is never dropped during memory pressure.
   - Internal network access only (isolated from the public internet).
3. **Database (Supabase PostgreSQL + PostGIS)**:
   - Hosted on Supabase.
   - **Important**: Render web services connect to the internet over IPv4. Because Supabase direct connections are IPv6-only, Render connects via Supabase's **IPv4 Session Pooler** connection string (`DATABASE_URL`, typically on port `5432` or `6543`).

---

### Deployment Methods

#### Method 1: Infrastructure as Code with Render Blueprint (`render.yaml`) — *Recommended*

FarmRent provides a production-grade Render Blueprint in [`render.yaml`](render.yaml).

1. Go to your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** → **Blueprint**.
3. Connect the repository: `Aravindreddykothuru/FarmRent` and branch `audit/farmrent-refactor`.
4. Render automatically parses `render.yaml` and provisions:
   - The `farmrent` Docker web service.
   - The `farmrent-redis` Key Value database.
   - Auto-generated cryptographic secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`).
   - Wired internal Redis connection string (`REDIS_URL`).
5. In the dashboard prompt, fill in the secrets marked `sync: false`:
   - `SUPABASE_URL`: Your Supabase project URL (`https://<project-ref>.supabase.co`)
   - `SUPABASE_SERVICE_KEY`: Supabase secret `service_role` key
   - `DATABASE_URL`: Supabase IPv4 Session Pooler connection string (`postgresql://postgres.<project-ref>:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres`)
   - `TWOFACTOR_API_KEY`: 2Factor.in SMS API key (optional for SMS OTP)
   - `MSG91_AUTH_KEY`: MSG91 authentication key (optional for email)
   - `SMTP_PASS`: Gmail App password for SMTP fallback
6. Click **Apply**. Render will build the Docker container and deploy the service.

#### Method 2: Manual Setup via Render Dashboard

If you prefer to configure the service manually:

1. **Create the Redis Instance**:
   - Dashboard → **New +** → **Key Value**.
   - Name: `farmrent-redis`, Region: `Singapore`, Plan: `Free` or `Starter`.
   - Copy the **Internal Connection String** (`REDIS_URL`).
2. **Create the Web Service**:
   - Dashboard → **New +** → **Web Service**.
   - Connect repository `Aravindreddykothuru/FarmRent`.
   - **Runtime**: `Docker`.
   - **Dockerfile Path**: `./Dockerfile`.
   - **Docker Build Context**: `.`.
   - **Region**: `Singapore`.
   - **Health Check Path**: `/health`.
   - **Auto-Deploy**: Turn `No` if using GitHub Actions CI gate (see below), or `Yes` if deploying immediately on git push.
3. **Add Environment Variables**: Add the variables from the table below.
4. **Attach Custom Domain**:
   - Go to Web Service Settings → **Custom Domains**.
   - Add `farmrentcom.in` and `www.farmrentcom.in`.
   - Add the CNAME / ALIAS DNS records provided by Render at your DNS registrar.

---

### CI/CD Deployment Pipeline (`render-deploy.yml`)

Instead of deploying unvalidated code on every push, production releases are controlled by [`.github/workflows/render-deploy.yml`](.github/workflows/render-deploy.yml):

- **Gated by Automated Tests**: Every push to `audit/farmrent-refactor` runs the entire test suite first (`ci.yml`: unit tests, integration tests, contract tests, ESLint, TypeScript check).
- **Pinned Commit Trigger**: The deploy step invokes the Render Deploy API (`POST https://api.render.com/v1/services/$SERVICE_ID/deploys`) specifically pinned to the verified `$GITHUB_SHA`. If tests fail, Render never builds or releases the commit.
- **Auditability**: Every deployment attempt leaves a visible record in GitHub Actions.
- **Manual Deploys**: Re-deploy anytime using **Run workflow** (`workflow_dispatch`) in the Actions tab.

> **GitHub Secrets Required for CI/CD**:
> - `RENDER_API_KEY`: Render Account API key (Account Settings → API Keys).
> - `RENDER_SERVICE_ID`: The service ID found in the Render web service URL (e.g. `srv-xxxxxx`).

---

### Database Migrations on Render / Supabase

Database migrations are managed via `Backend_Node_legacy/db/migrate.js` and should be run before deploying code changes that require schema alterations:

```bash
# From Backend_Node_legacy directory:
DATABASE_URL="postgresql://postgres.<project-ref>:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres" npm run migrate
```

- The migration runner is strictly **idempotent**, acquires a PostgreSQL advisory lock, records SHA-256 checksums in `schema_migrations`, and skips already-applied migrations.
- The Render build process does not run migrations automatically, ensuring production schema changes are reviewed and applied with backups.

---

### Render Environment Variables Reference

| Variable | Required | Default / Value | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Enables production optimizations and disables demo endpoints |
| `PORT` | Auto | `3000` | Port listened to by the unified server (managed by Render) |
| `TRUST_PROXY` | **Yes** | `1` | Tells Express it is behind Render's reverse proxy so client IP rate limiting works |
| `APP_URL` | Yes | `https://farmrentcom.in` | Public production URL (or `https://farmrent-l9gk.onrender.com`) |
| `CLIENT_URL` | Yes | `https://farmrentcom.in` | Used for redirect links and transactional email URLs |
| `NEXT_PUBLIC_APP_URL` | Yes | `https://farmrentcom.in` | Public URL baked into client-side links |
| `ALLOWED_ORIGINS` | Yes | `https://farmrentcom.in,https://www.farmrentcom.in,https://farmrent-l9gk.onrender.com` | Allowed CORS origins for browser API calls |
| `JWT_SECRET` | Yes | Auto-generated | 32+ character key for signing 15-minute access JWTs |
| `JWT_REFRESH_SECRET`| Yes | Auto-generated | 32+ character key for signing refresh tokens |
| `REDIS_URL` | Yes | From Key Value | Connection string for sessions, queues, rate limits, and Socket.IO |
| `SUPABASE_URL` | Yes | `https://<ref>.supabase.co` | Supabase project REST API URL |
| `SUPABASE_SERVICE_KEY`| Yes | `ey...` | Secret service role key (bypasses RLS for API operations) |
| `DATABASE_URL` | Yes | `postgresql://...` | Supabase IPv4 Session Pooler connection string for migrations |
| `TWOFACTOR_API_KEY` | Optional | Dashboard secret | 2Factor.in API key for SMS OTP authentication |
| `TWOFACTOR_TEMPLATE`| Optional | `""` | DLT approved template name (or empty for 2Factor default) |
| `EMAIL_PROVIDERS` | Optional | `msg91,smtp` | Comma-separated list of enabled email delivery backends |
| `EMAIL_PROVIDER` | Optional | `smtp` | Primary email driver |
| `SMTP_HOST` / `PORT`| Optional | `smtp.gmail.com` / `587` | SMTP relay server settings |
| `SMTP_USER` / `PASS`| Optional | `farmrent862@gmail.com` | SMTP credentials |
| `MSG91_AUTH_KEY` | Optional | Dashboard secret | MSG91 transactional email auth key |
| `RAZORPAY_KEY_ID` | Optional | `rzp_live_*` | Razorpay gateway API key |
| `RAZORPAY_KEY_SECRET`| Optional| Dashboard secret | Razorpay gateway secret |
| `RAZORPAY_WEBHOOK_SECRET`| Prod | Dashboard secret | Verifies raw-body signatures for `/api/payment/webhook` |

*(Note: Railway deployment has been decommissioned and removed; Render is the designated production hosting platform).*

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
