# FarmRent — Workspace Agent Rules

## Project Overview

**FarmRent** is a full-stack farm equipment rental platform connecting farmers with equipment owners.
Single unified server (`nextfrontend/server.js`) serves both Next.js (port 3000) and Express REST API on the same port.

### Stack at a Glance
| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui |
| Backend | Node.js 20, Express 4 (`Backend_Node_legacy/`) |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | Custom JWT (access 15 min + refresh 7 days), email OTP |
| Payments | Razorpay (primary) + Stripe (secondary) |
| Real-time | Socket.IO (notifications + GPS tracking) |
| Cache | Redis (driver geo-search, rate limiting, OTP) |
| Search | Elasticsearch 8.x |
| Email | Multi-provider: Brevo SMTP → Gmail SMTP → Resend API → Ethereal |
| GPS | Supabase Realtime + Socket.IO + OSRM routing |
| CI | GitHub Actions |

---

## Directory Structure

```
farmers/
├── Backend_Node_legacy/        ← Express REST API (primary backend)
│   ├── app.js                  ← Express app factory (no listen)
│   ├── server.js               ← Standalone dev entry only
│   ├── services/               ← Feature micro-services (auth, booking, payment, etc.)
│   ├── routes/                 ← Shared routes (messages, invoices, kyc, etc.)
│   ├── middleware/             ← auth, requireRole, errorHandler, rateLimiter, etc.
│   ├── lib/                    ← Shared libs (logger, config, emailService, metrics)
│   ├── workers/                ← BullMQ workers (invoice, cron, image)
│   ├── prisma/                 ← Prisma schema + migrations
│   └── .env                   ← Single source of truth for ALL env vars
├── nextfrontend/               ← Next.js 16 App Router frontend
│   ├── server.js               ← Unified server entry (Next + Express on same port)
│   ├── app/                    ← App Router pages and layouts
│   ├── components/             ← Reusable React components
│   └── .env.local              ← Frontend-specific env vars (NEXT_PUBLIC_*)
├── agronexus-springboot/       ← Spring Boot service (secondary/experimental)
├── FutureEnhancement/          ← Flask sidecar (ML features, /api/v2 proxy)
├── GPS/                        ← GPS tracking service files
├── nginx/                      ← Nginx gateway config
├── docker-compose.yml          ← Full stack: postgres, redis, elasticsearch, nginx
└── Dockerfile                  ← Unified app container
```

---

## Coding Conventions

### Backend (Node.js / Express)
- All services live under `Backend_Node_legacy/services/<name>-service/routes.js`
- Route handlers should be thin; business logic goes in repositories or service files
- Use `require('./lib/logger')` (Pino) for logging — **never** `console.log` in production code
- Error handling: always call `next(err)` to propagate to `errorHandler` middleware
- Authentication: use `auth(required)` middleware — `auth(true)` = mandatory, `auth(false)` = optional
- Role checks: use `requireRole('admin' | 'farmer' | 'owner')` after `auth(true)`
- Rate limiters from `middleware/redisRateLimiter.js`: `authLimiter`, `paymentLimiter`, `generalLimiter`
- Validation: use **Zod** schemas for request body/query validation
- Background jobs: use **BullMQ** queues via `lib/queueManager.js`
- Environment variables are validated at startup in `lib/config.js` — add new vars there

### Frontend (Next.js)
- Use the **App Router** (`app/` directory) — no Pages Router
- Tailwind CSS + shadcn/ui components — follow existing component patterns in `components/`
- API calls go through the unified server at `/api/v1/*` (no separate backend URL in prod)
- Real-time features use `socket.io-client` from the `hooks/` directory
- Forms: `react-hook-form` + Zod resolvers
- Translations: `i18n/` with next-intl — always add keys to messages files

### Environment Variables
- Backend env: `Backend_Node_legacy/.env` — use `lib/config.js` to access and validate
- Frontend env: `nextfrontend/.env.local` — only `NEXT_PUBLIC_*` vars are exposed to browser
- **Never commit `.env` or `.env.local` files** — only update `.env.example` files

---

## Critical Architecture Notes

1. **Single Port, Single Process**: In production, `nextfrontend/server.js` is the ONLY entry point.
   Requests to `/api/*` and `/socket.io/*` are handled by Express; everything else goes to Next.js.

2. **Backend_Node_legacy is the real backend**: Despite the `_legacy` name, this IS the active production backend.
   `agronexus-springboot/` is a secondary service and should not be confused with the primary.

3. **Flask Sidecar (`/api/v2`)**: ML/AI features proxy to `http://localhost:5001` (Flask).
   The Node backend proxies `/api/v2/*` to Flask via `http-proxy-middleware`.

4. **Prisma + Supabase**: Prisma handles schema/migrations; Supabase JS client is used for realtime subscriptions and some queries. Do NOT use both for the same table operations — prefer Supabase client for realtime, Prisma for transactional queries.

5. **Email Service Fallback Chain**: `emailService.js` tries providers in order:
   Brevo SMTP → Gmail SMTP → Resend API → Ethereal (dev). Always test with Ethereal in dev.

6. **Redis is Optional**: The app degrades gracefully if Redis is unavailable (rate limiting and geo-search fall back; OTP uses in-memory store).

7. **BullMQ Workers**: `invoiceWorker`, `cronWorker`, `imageWorker` are auto-started when `app.js` loads. Do not duplicate require calls.

---

## Development Workflow

### Starting the App Locally
```powershell
# From nextfrontend/ — runs unified server (Next.js + Express on port 3000)
npm run dev

# Or with Docker (full stack including Postgres, Redis, Elasticsearch)
docker-compose up --build
```

### Running Backend Tests
```powershell
# From Backend_Node_legacy/
npm test
```

### Database Migrations
```powershell
# From Backend_Node_legacy/ — Prisma migrations
npx prisma migrate dev --name <migration_name>
npx prisma generate

# Or use the provided PowerShell scripts from root
.\apply-migrations.ps1
.\run-migrations.ps1
```

---

## MCP Server Integration

### Supabase MCP (`supabase-mcp-server`)
- Use `execute_sql` to run ad-hoc queries against the Supabase PostgreSQL database
- Use `list_tables` / `list_migrations` before modifying schema
- Always use `apply_migration` for schema changes (not raw SQL in prod)
- Use `get_logs` to investigate Supabase edge function errors

### Stripe MCP (`stripe`)
- The project uses **Razorpay as primary** and Stripe as secondary payment provider
- Use Stripe MCP tools for Stripe-specific features only (webhooks, refunds via `create_refund`)
- Check `Backend_Node_legacy/services/payment-service/` for the active payment integration

---

## Common Gotchas

- **`Backend_Node_legacy` not `Backend`**: The README mentions `Backend/` but the actual directory is `Backend_Node_legacy/`. Always use the correct path.
- **Prisma client import**: Always `const { PrismaClient } = require('@prisma/client')` — the client is generated to `node_modules/@prisma/client`.
- **CORS**: In dev, localtunnel (`.loca.lt`) and ngrok origins are auto-allowed. In prod, set `ALLOWED_ORIGINS` env var.
- **Webhook body parsing**: `/api/payment/webhook` skips `express.json()` to preserve raw body for Razorpay signature verification. Do NOT add body parsing middleware on this route.
- **Socket.IO namespace**: The unified server in `nextfrontend/server.js` attaches Socket.IO — import from there, not from a separate backend Socket.IO instance.
- **Next.js public env**: Variables exposed to the browser MUST be prefixed with `NEXT_PUBLIC_`. Others are server-side only.

---

## File Naming Patterns

| Artifact | Pattern |
|---|---|
| Express service routes | `services/<name>-service/routes.js` |
| Express standalone routes | `routes/<name>.js` |
| BullMQ workers | `workers/<name>Worker.js` |
| Shared libs | `lib/<name>.js` |
| Middleware | `middleware/<name>.js` |
| Next.js pages | `app/<path>/page.tsx` |
| Next.js layouts | `app/<path>/layout.tsx` |
| Next.js API routes | `app/api/<path>/route.ts` |
| React components | `components/<Name>.tsx` |
| Custom hooks | `hooks/use<Name>.ts` |
