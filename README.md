# FarmRent — Farm Equipment Rental Platform

A full-stack platform that connects farmers with equipment owners for renting tractors, harvesters, and other farm machinery. Built with Next.js 16, Express, Supabase, Razorpay, and Socket.IO.

---

## Architecture

```
Browser / Mobile
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│           Unified Server  (nextfrontend/server.js)       │
│                 One process · One port (3000)            │
│                                                          │
│  /api/*  ─────────────────────► Express Backend         │
│  /socket.io/*  ────────────────► Socket.IO              │
│  /uploads/*  ──────────────────► Static files           │
│  /* (everything else) ─────────► Next.js App Router     │
└──────────┬──────────────────────────────────┬───────────┘
           │                                  │
           ▼                                  ▼
    ┌─────────────┐                  ┌──────────────────┐
    │  Supabase   │                  │  Redis (optional)│
    │ (PostgreSQL)│                  │  Driver geo-     │
    │  Database   │                  │  search + rate   │
    │  Realtime   │                  │  limiting        │
    └─────────────┘                  └──────────────────┘
           │
    ┌──────┴──────────────────────────────────────────────┐
    │  External Services                                   │
    │  • Razorpay   — UPI / card payments + webhooks      │
    │  • Resend / Brevo / Gmail — transactional email     │
    │  • MSG91 / Twilio — SMS OTP                         │
    └─────────────────────────────────────────────────────┘
```

### Key Design Decision — Unified Server

`nextfrontend/server.js` starts a single Node.js process that serves both Next.js pages and the Express REST API on the same port. There is **no separate backend process** in production.

```
Request comes in
  if /api/* or /socket.io/* or /health → Express handles it
  else                                 → Next.js handles it
```

This means:
- One Railway service, one port, one deploy
- Next.js API routes (`/app/api/...`) and Express routes (`/api/v1/...`, `/api/payment/...`) coexist
- `Backend/.env` is the single source of truth for all environment variables

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui |
| Backend | Node.js 20, Express 4 |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | Custom JWT (access 15min + refresh 7d), email OTP |
| Payments | Razorpay — UPI, cards, netbanking, wallets + COD fallback |
| Real-time | Socket.IO (notifications + GPS tracking) |
| Cache | Redis (driver geosearch, rate limiting, OTP) |
| Email | Multi-provider: Resend → Brevo → Gmail SMTP → Ethereal |
| GPS | Supabase Realtime + Socket.IO + OSRM routing |
| Deploy | Railway (Docker), GitHub Actions CI |

---

## Project Structure

```
farmers/
├── Dockerfile              ← Production Docker image (unified server)
├── railway.toml            ← Railway deployment config
├── docker-compose.yml      ← Local dev with Redis + app
│
├── Backend/                ← Express REST API
│   ├── app.js              ← Express app factory
│   ├── server.js           ← Standalone backend entry (dev only)
│   ├── .env                ← All environment variables (gitignored)
│   ├── .env.example        ← Template — copy to .env
│   │
│   ├── routes/             ← API route handlers
│   │   ├── payment.js      ← Razorpay create-order, verify, webhook, refund
│   │   ├── machines.js     ← Equipment CRUD + search
│   │   ├── messages.js     ← Chat messages
│   │   ├── reviews.js      ← Equipment reviews
│   │   ├── notifications.js
│   │   ├── offers.js       ← Price negotiation
│   │   ├── disputes.js
│   │   ├── kyc.js
│   │   └── ...
│   │
│   ├── services/           ← Modular microservice-style handlers
│   │   ├── auth-service/   ← Register, login, OTP, password reset
│   │   ├── booking-service/← Create booking, driver assignment, routing
│   │   ├── equipment-service/
│   │   ├── tracking-service/ ← Socket.IO + Redis geo
│   │   ├── user-service/   ← Profile, avatar upload
│   │   ├── driver-service/ ← Driver registration and location
│   │   └── routing-service/ ← OSRM route calculation
│   │
│   ├── lib/
│   │   ├── supabase.js     ← Supabase client (service role)
│   │   ├── emailService.js ← Multi-provider email
│   │   ├── otpService.js   ← SMS + in-memory OTP
│   │   ├── notificationService.js ← Push via Socket.IO
│   │   └── refundService.js ← Razorpay refunds
│   │
│   └── supabase/
│       ├── schema.sql      ← Full DB schema
│       └── migrations/
│           └── FIX_run_this_in_supabase.sql  ← Run once in Supabase SQL Editor
│
└── nextfrontend/           ← Next.js 16 App Router frontend
    ├── server.js           ← UNIFIED SERVER ENTRY POINT (production + dev)
    ├── next.config.ts
    │
    ├── app/                ← Next.js pages (App Router)
    │   ├── page.tsx            ← Home / browse equipment
    │   ├── browse/             ← Equipment search with filters
    │   ├── equipment/[id]/     ← Equipment detail
    │   ├── book/[machineId]/   ← Booking form + Razorpay / COD payment
    │   ├── bookings/           ← My bookings list
    │   ├── bookings/[id]/      ← Booking detail + tracking
    │   ├── payment/success/    ← Payment confirmation (Razorpay + COD)
    │   ├── dashboard/
    │   │   ├── farmer/         ← Farmer dashboard
    │   │   ├── owner/          ← Equipment owner dashboard
    │   │   ├── driver/         ← Driver dashboard
    │   │   └── admin/          ← Admin panel
    │   ├── tracking/[bookingId]/ ← Live GPS map
    │   ├── chats/              ← Messaging
    │   ├── wallet/             ← Wallet & transactions
    │   ├── login/ register/ forgot-password/ ← Auth
    │   └── api/tracking/update/ ← GPS update endpoint (Next.js route)
    │
    ├── components/
    │   ├── TrackingMap.tsx     ← Leaflet real-time map
    │   ├── BookingChat.tsx     ← In-booking chat
    │   ├── NotificationBell.tsx ← Real-time socket notifications
    │   ├── DriverInfoCard.tsx  ← Assigned driver + ETA
    │   └── ...
    │
    ├── hooks/
    │   ├── useRazorpay.ts      ← Razorpay SDK integration
    │   ├── useTrackingSocket.ts
    │   └── useDriverGPS.ts
    │
    └── context/
        ├── AuthContext.tsx     ← JWT auth state
        └── LanguageContext.tsx ← i18n (10 Indian languages)
```

---

## Database Schema (Supabase)

```
users              — accounts (custom auth, not Supabase Auth)
equipment          — listings (owner, location, price, images)
bookings           — rental records with driver assignment + GPS lifecycle
payments           — Razorpay payment records + COD
drivers            — driver profiles + real-time location
equipment_tracking — GPS breadcrumb trail
notifications      — in-app notifications (Socket.IO)
messages / chats   — equipment + booking messaging
reviews            — equipment ratings
disputes           — booking dispute resolution
kyc_documents      — Aadhaar / license verification
promo_codes        — discount codes
favorites          — user wishlists
offers             — price negotiation between farmer and owner
refresh_tokens     — JWT refresh token store
```

**First-time Supabase setup:** Run `Backend/supabase/migrations/FIX_run_this_in_supabase.sql` in Supabase Dashboard → SQL Editor. It's idempotent (safe to re-run).

---

## Payment Flow

```
Farmer selects equipment
       │
       ├── Razorpay (UPI / card / netbanking / wallet)
       │     1. POST /api/payment/create-order → Razorpay order
       │     2. Razorpay checkout in browser
       │     3. POST /api/payment/verify → HMAC verify → mark paid
       │     4. Booking status → confirmed, payment_status → paid
       │     5. Webhook (/api/payment/webhook) as backup confirmation
       │
       └── Cash on Delivery
             1. Booking created with payment_method = 'cod'
             2. Redirect to /payment/success?method=cod
             3. Payment collected when equipment arrives
```

Razorpay test keys work for development. For real money use `rzp_live_*` keys.

---

## Real-time Features (Socket.IO)

| Namespace | Events | Purpose |
|---|---|---|
| `/notifications` | `notification` | Booking updates, payment alerts |
| `/tracking` | `location:update`, `driver:assigned` | Live equipment GPS |

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- A free [Supabase](https://supabase.com) project
- Razorpay test account keys

### 1. Clone and install

```bash
git clone https://github.com/Aravindreddykothuru/FarmRent.git
cd FarmRent

# Backend dependencies
cd Backend && npm install

# Frontend dependencies
cd ../nextfrontend && npm install
```

### 2. Configure environment

```bash
cd Backend
cp .env.example .env
# Edit .env — fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET,
#              RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
```

### 3. Set up database

Open Supabase Dashboard → SQL Editor → New Query, paste the contents of:
```
Backend/supabase/migrations/FIX_run_this_in_supabase.sql
```
Click **Run**.

### 4. Start the app (single command)

```bash
cd nextfrontend
npm run dev
# → http://localhost:3002  (both UI and API)
```

### 5. Optional: Redis (for driver geo-tracking + rate limiting)

```bash
docker run -d -p 6379:6379 redis:7-alpine
# Set REDIS_URL=redis://127.0.0.1:6379 in Backend/.env
```

---

## Environment Variables

All variables live in `Backend/.env`. See `Backend/.env.example` for the full list.

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key (secret) |
| `JWT_SECRET` | Yes | Access token signing key |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing key |
| `RAZORPAY_KEY_ID` | Yes | `rzp_test_*` or `rzp_live_*` |
| `RAZORPAY_KEY_SECRET` | Yes | Razorpay secret |
| `RAZORPAY_WEBHOOK_SECRET` | Prod | Razorpay webhook verification |
| `APP_URL` | Yes | Public URL (e.g. `https://your-app.up.railway.app`) |
| `ALLOWED_ORIGINS` | Yes | CORS allowed origins (comma-separated) |
| `RESEND_API_KEY` | Email | Resend API key (recommended) |
| `BREVO_SMTP_USER` | Email | Brevo SMTP fallback |
| `SMTP_HOST/USER/PASS` | Email | Gmail SMTP fallback |
| `REDIS_URL` | Optional | Redis connection string |
| `PORT` | Auto | Set by Railway automatically |

---

## Deployment (Railway)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select `Aravindreddykothuru/FarmRent`
3. Railway auto-detects `Dockerfile` and `railway.toml`
4. Add a **Redis** addon: New → Database → Redis (Railway sets `REDIS_URL` automatically)
5. Go to **Variables** tab, add all required env vars from the table above
6. Set `APP_URL` and `CLIENT_URL` and `ALLOWED_ORIGINS` to your Railway public domain
7. Click **Deploy**

Build takes ~3-5 minutes (installs deps + Next.js build). Health check: `GET /health`

---

## API Reference

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Register + email OTP sent |
| POST | `/api/v1/auth/verify-otp` | Verify OTP → get JWT |
| POST | `/api/v1/auth/login` | Login with email + password |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/forgot-password` | Send reset email |

### Equipment
| Method | Path | Description |
|---|---|---|
| GET  | `/api/v1/machines` | List/search equipment |
| POST | `/api/v1/machines` | Add listing (owner) |
| GET  | `/api/v1/machines/:id` | Equipment detail |
| PUT  | `/api/v1/machines/:id` | Update listing |

### Bookings
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/bookings` | Create booking (auto-assigns driver) |
| GET  | `/api/v1/bookings` | My bookings |
| GET  | `/api/v1/bookings/:id` | Booking detail |
| PATCH | `/api/v1/bookings/:id/status` | Update booking status |

### Payments
| Method | Path | Description |
|---|---|---|
| POST | `/api/payment/create-order` | Create Razorpay order |
| POST | `/api/payment/verify` | Verify + confirm payment |
| GET  | `/api/payment/status?orderId=` | Poll payment status |
| POST | `/api/payment/refund` | Initiate refund |
| POST | `/api/payment/webhook` | Razorpay webhook handler |

### Tracking
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/tracking/update` | Emit GPS location (Socket.IO) |
| GET  | `/api/v1/tracking/:bookingId` | Current position |
| GET  | `/api/v1/tracking/:bookingId/history` | GPS breadcrumbs |

---

## Supported Languages

English · Hindi · Telugu · Tamil · Kannada · Malayalam · Gujarati · Marathi · Punjabi · Bengali

---

## License

MIT
