-- ============================================================
-- FarmRent — Supabase PostgreSQL Schema
-- Run this once in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'farmer' CHECK (role IN ('farmer','owner','admin')),
    phone         TEXT,
    avatar_url    TEXT,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── EQUIPMENT ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,
    description     TEXT,
    price_per_day   NUMERIC(10,2) NOT NULL,
    location        TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    geohash         TEXT,
    images          TEXT[] DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','rented','maintenance','pending_approval')),
    horsepower      INT,
    year            INT,
    brand           TEXT,
    is_approved     BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BOOKINGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id    UUID REFERENCES equipment(id) ON DELETE SET NULL,
    renter_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    farmer_name     TEXT,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    total_amount    NUMERIC(10,2) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
    payment_method  TEXT DEFAULT 'razorpay',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PAYMENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID REFERENCES users(id) ON DELETE SET NULL,
    razorpay_order_id    TEXT UNIQUE NOT NULL,
    razorpay_payment_id  TEXT,
    razorpay_signature   TEXT,
    amount_paise         INTEGER NOT NULL,
    currency             TEXT DEFAULT 'INR',
    status               TEXT CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')) DEFAULT 'pending',
    error_description    TEXT,
    paid_at              TIMESTAMPTZ,
    created_at           TIMESTAMPTZ DEFAULT now(),

    -- Booking linkage
    booking_id           UUID REFERENCES bookings(id) ON DELETE SET NULL,
    -- Refund tracking
    refund_id            TEXT,
    refund_amount_paise  INTEGER,
    refunded_at          TIMESTAMPTZ,
    refund_reason        TEXT,
    -- Back-compat
    amount               NUMERIC(10,2),
    method               TEXT,
    transaction_id       TEXT,
    stripe_payment_id    TEXT
);

-- Verification attempts log
CREATE TABLE IF NOT EXISTS payments_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    success             BOOLEAN NOT NULL,
    message             TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ─── LOCATIONS (GPS Tracking) ────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id    UUID REFERENCES equipment(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    altitude        DOUBLE PRECISION,
    speed           DOUBLE PRECISION,
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── REVIEWS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id   UUID UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
    equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
    reviewer_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── NOTIFICATIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'system',
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    is_read    BOOLEAN DEFAULT FALSE,
    data       JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── MESSAGES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
    sender_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    content    TEXT NOT NULL,
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── KYC DOCUMENTS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_documents (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    doc_type         TEXT NOT NULL CHECK (doc_type IN ('aadhar','driving_license','farm_proof','gst')),
    file_url         TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    rejection_reason TEXT,
    reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── DISPUTES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id     UUID REFERENCES bookings(id) ON DELETE CASCADE,
    raised_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    type           TEXT NOT NULL CHECK (type IN ('equipment_damage','non_return','payment_dispute','service_issue','other')),
    description    TEXT NOT NULL,
    evidence_urls  TEXT[] DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved_farmer','resolved_owner','closed')),
    admin_notes    TEXT,
    resolved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ALTER EXISTING TABLES ───────────────────────────────────
ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS avg_rating   NUMERIC(3,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'unverified'
        CHECK (kyc_status IN ('unverified','pending','verified','rejected'));

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS refund_amount_paise INTEGER,
    ADD COLUMN IF NOT EXISTS refund_reason TEXT;

-- ─── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_equipment_owner   ON equipment(owner_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status  ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_bookings_renter   ON bookings(renter_id);
CREATE INDEX IF NOT EXISTS idx_bookings_owner    ON bookings(owner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_equip    ON bookings(equipment_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking  ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_locations_equip   ON locations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_reviews_equipment ON reviews(equipment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_booking  ON messages(booking_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_kyc_user          ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status        ON kyc_documents(status);
CREATE INDEX IF NOT EXISTS idx_disputes_booking  ON disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status   ON disputes(status);

-- ─── UPDATED_AT TRIGGER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_equip_updated_at    BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON bookings  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON disputes  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── HELPER FUNCTIONS ────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_equipment_avg_rating(p_equipment_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE equipment SET
        avg_rating   = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE equipment_id = p_equipment_id),
        review_count = (SELECT COUNT(*) FROM reviews WHERE equipment_id = p_equipment_id)
    WHERE id = p_equipment_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
--
-- Notes:
-- - This repo’s Node backend uses the Supabase **service_role** key which bypasses RLS.
--   RLS is still recommended if/when you move any reads/writes to the browser anon client.
-- - If you keep service_role in the backend, you must still enforce ownership checks in
--   your Express routes (RLS will not protect you there).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Users: each user can read/update their own profile row.
DO $$
BEGIN
  CREATE POLICY users_select_own ON users
    FOR SELECT USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY users_update_own ON users
    FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Equipment: owners manage their own equipment. Public can read approved/available equipment.
DO $$
BEGIN
  CREATE POLICY equipment_public_read ON equipment
    FOR SELECT USING (is_approved = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY equipment_owner_write ON equipment
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Bookings: renter/owner can read their own bookings; renters can create for themselves.
DO $$
BEGIN
  CREATE POLICY bookings_read_own ON bookings
    FOR SELECT USING (auth.uid() = renter_id OR auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY bookings_create_renter ON bookings
    FOR INSERT WITH CHECK (auth.uid() = renter_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Payments: only read payments tied to bookings you own/created (via booking relationship).
-- (If you expose payments to the client, consider a view with joins instead.)

-- Live Razorpay policies (Supabase Auth) — required if the browser reads payments directly.
DO $$
BEGIN
  CREATE POLICY payments_select_own ON payments
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY payments_insert_own ON payments
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
