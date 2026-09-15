-- =============================================================================
-- FarmRent — COMPLETE ONE-SHOT FIX
-- Run this ONCE in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/lulgifjlhvnwsgvrzzym/sql/new
--
-- Every block uses IF NOT EXISTS / DO $$ EXCEPTION guards — safe to re-run.
-- =============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: MISSING CORE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── USERS ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    full_name     TEXT,
    role          TEXT NOT NULL DEFAULT 'farmer',
    phone         TEXT,
    avatar_url    TEXT,
    password_hash TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── EQUIPMENT ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id      UUID REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,
    description   TEXT,
    price_per_day NUMERIC(10,2) NOT NULL,
    location      TEXT,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    geohash       TEXT,
    images        TEXT[] DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'available',
    horsepower    INT,
    year          INT,
    brand         TEXT,
    is_approved   BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── BOOKINGS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id   UUID REFERENCES equipment(id) ON DELETE SET NULL,
    renter_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    farmer_name    TEXT,
    start_date     DATE NOT NULL,
    end_date       DATE NOT NULL,
    total_amount   NUMERIC(10,2) NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT DEFAULT 'razorpay',
    notes          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAYMENTS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature  TEXT,
    amount_paise        INTEGER,
    currency            TEXT DEFAULT 'INR',
    status              TEXT DEFAULT 'pending',
    error_description   TEXT,
    paid_at             TIMESTAMPTZ,
    booking_id          UUID REFERENCES bookings(id) ON DELETE SET NULL,
    refund_id           TEXT,
    refund_amount_paise INTEGER,
    refunded_at         TIMESTAMPTZ,
    refund_reason       TEXT,
    amount              NUMERIC(10,2),
    method              TEXT,
    transaction_id      TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── REVIEWS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
    reviewer_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    rating       NUMERIC(3,2) NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── DISPUTES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id  UUID REFERENCES bookings(id) ON DELETE CASCADE,
    raised_by   UUID REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'open',
    resolution  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── MESSAGES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id  UUID REFERENCES bookings(id) ON DELETE CASCADE,
    sender_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    is_read     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── USER SESSIONS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id   TEXT UNIQUE NOT NULL,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── KYC DOCUMENTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_documents (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    doc_type   TEXT NOT NULL,
    doc_number TEXT,
    file_url   TEXT,
    status     TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── LOCATIONS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
    lat          DOUBLE PRECISION,
    lng          DOUBLE PRECISION,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── NOTIFICATIONS (was missing → 500 on every page load) ─────────────────────
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
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;

-- ── FAVORITES (was missing → 500 on /api/v1/favorites/ids) ───────────────────
CREATE TABLE IF NOT EXISTS favorites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user  ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_equip ON favorites(equipment_id);

-- ── OFFERS / PRICE NEGOTIATION ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id          TEXT NOT NULL,
    renter_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offered_price_per_day NUMERIC(10,2) NOT NULL,
    start_date            DATE NOT NULL,
    end_date              DATE NOT NULL,
    total_days            INT GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
    message               TEXT,
    status                VARCHAR(20) DEFAULT 'pending'
                              CHECK (status IN ('pending','accepted','rejected','countered','expired')),
    counter_price         NUMERIC(10,2),
    counter_message       TEXT,
    booking_id            UUID REFERENCES bookings(id) ON DELETE SET NULL,
    expires_at            TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offers_renter    ON offers(renter_id);
CREATE INDEX IF NOT EXISTS idx_offers_owner     ON offers(owner_id);
CREATE INDEX IF NOT EXISTS idx_offers_equipment ON offers(equipment_id);
CREATE INDEX IF NOT EXISTS idx_offers_status    ON offers(status);

-- ── SAVED SEARCHES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_searches (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(200) NOT NULL,
    filters    JSONB NOT NULL DEFAULT '{}',
    alert_on   BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);

-- ── CHATS (OLX-style per-equipment conversations) ─────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    farmer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (equipment_id, farmer_id)
);
CREATE INDEX IF NOT EXISTS idx_chats_farmer_id    ON chats(farmer_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner_id     ON chats(owner_id);
CREATE INDEX IF NOT EXISTS idx_chats_equipment_id ON chats(equipment_id);

-- ── EQUIPMENT TRACKING (live GPS) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_tracking (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    timestamp    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_tracking_equipment ON equipment_tracking (equipment_id, timestamp DESC);

-- ── DRIVERS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,
    name           TEXT        NOT NULL,
    phone          TEXT        NOT NULL,
    license_number TEXT,
    vehicle_name   TEXT,
    vehicle_type   TEXT,
    vehicle_number TEXT,
    current_lat    DOUBLE PRECISION,
    current_lng    DOUBLE PRECISION,
    is_available   BOOLEAN     NOT NULL DEFAULT TRUE,
    rating         NUMERIC(3,2) DEFAULT 0,
    total_trips    INT         DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers(is_available) WHERE is_available = TRUE;
CREATE INDEX IF NOT EXISTS idx_drivers_user      ON drivers(user_id);

-- ── REFRESH TOKENS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT        NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash    ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ── PROMO CODES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT        NOT NULL UNIQUE,
    description     TEXT,
    label           TEXT,
    discount_type   TEXT        NOT NULL DEFAULT 'flat' CHECK (discount_type IN ('percent', 'flat')),
    discount_value  NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(10,2) DEFAULT 0,
    min_amount      NUMERIC(10,2) DEFAULT 0,   -- alias for backwards compat
    max_discount    NUMERIC(10,2),
    usage_limit     INT,
    used_count      INT         NOT NULL DEFAULT 0,
    valid_from      TIMESTAMPTZ DEFAULT NOW(),
    valid_until     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,               -- alias for valid_until
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code   ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active) WHERE is_active = TRUE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: ALTER EXISTING TABLES — ADD MISSING COLUMNS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Users auth columns ────────────────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified        BOOLEAN     NOT NULL DEFAULT FALSE; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token    TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expiry   TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token  TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expiry TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified        BOOLEAN     NOT NULL DEFAULT FALSE; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_otp_hash        TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_otp_expiry      TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts          SMALLINT    NOT NULL DEFAULT 0;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at         TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip         TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status            TEXT        DEFAULT 'unverified'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode               TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS town                  TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS village               TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_email_verify_token   ON users(email_verify_token)   WHERE email_verify_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;

-- ── Bookings extra columns ────────────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method   TEXT    DEFAULT 'razorpay';   EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status   TEXT    DEFAULT 'pending';    EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes            TEXT;                         EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_id        UUID;                         EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lat       DOUBLE PRECISION;             EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lng       DOUBLE PRECISION;             EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lat      DOUBLE PRECISION;             EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lng      DOUBLE PRECISION;             EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS distance_km      NUMERIC(10,2);               EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eta_minutes      INTEGER;                      EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS route_geometry   TEXT;                         EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accepted_at      TIMESTAMPTZ;                  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ;                  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ;                  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS geofence_radius_km NUMERIC(6,2) DEFAULT 50;   EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── Payments extra columns ────────────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id              UUID;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_id           UUID;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount               NUMERIC(10,2); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS method               TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_id       TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_id            TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at          TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_amount_paise  INTEGER;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_reason        TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── Messages & Chats extra columns (for chat system) ──────────────────────────
DO $$ BEGIN ALTER TABLE chats    ADD COLUMN IF NOT EXISTS booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE offers   ADD COLUMN IF NOT EXISTS booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE disputes ADD COLUMN IF NOT EXISTS booking_id  UUID REFERENCES bookings(id) ON DELETE CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS booking_id  UUID REFERENCES bookings(id) ON DELETE CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_id     UUID REFERENCES chats(id)    ON DELETE CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image')); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── Equipment GPS + location + category columns ─────────────────────────────
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS type              TEXT        DEFAULT 'tractor'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS category          TEXT        DEFAULT 'tractor'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS status            TEXT        DEFAULT 'available'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS is_approved       BOOLEAN     DEFAULT TRUE; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS horsepower        INT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS brand             TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS year              INT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS price_per_day     NUMERIC(10,2) DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS latitude          DOUBLE PRECISION; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS longitude         DOUBLE PRECISION; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS address_full      TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS village           TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS town              TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS district          TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS state             TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pincode           VARCHAR(6);     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC DEFAULT 50; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS service_pincodes  TEXT[]  DEFAULT '{}'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS avg_rating        NUMERIC DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS rating_count      INTEGER DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS review_count      INT DEFAULT 0;  EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Migrate existing location text → district (if location column exists)
DO $$ 
BEGIN 
    EXECUTE 'UPDATE equipment SET district = location WHERE district IS NULL AND location IS NOT NULL AND location <> '''''; 
EXCEPTION WHEN OTHERS THEN 
    NULL; 
END $$;

-- ── Drivers → add vehicle_name column (was missing, caused join query errors) ─
DO $$ BEGIN ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_name TEXT; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: FIX CONSTRAINT VIOLATIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Fix bookings.status CHECK — add 'requested' and 'in_progress' statuses
DO $$
BEGIN
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('requested', 'pending', 'accepted', 'confirmed', 'in_progress', 'completed', 'cancelled'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Fix payments.status CHECK — add 'refunded'
DO $$
BEGIN
  ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
  ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add FK: bookings → drivers (safe: only if column + table exist)
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_driver_id_fkey
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 4: STORED PROCEDURES & RPCs
-- ═══════════════════════════════════════════════════════════════════════════════

-- updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ BEGIN CREATE TRIGGER trg_users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_equip_updated_at    BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON bookings  FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON disputes  FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_offers_updated_at   BEFORE UPDATE ON offers    FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_drivers_updated_at  BEFORE UPDATE ON drivers   FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- compute_equipment_avg_rating RPC
CREATE OR REPLACE FUNCTION compute_equipment_avg_rating(p_equipment_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE equipment SET
        avg_rating   = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE equipment_id = p_equipment_id),
        review_count = (SELECT COUNT(*) FROM reviews WHERE equipment_id = p_equipment_id)
    WHERE id = p_equipment_id;
END;
$$;

-- drivers_increment_trips RPC (WAS MISSING — caused silent booking completion failure)
CREATE OR REPLACE FUNCTION drivers_increment_trips(driver_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE drivers SET total_trips = COALESCE(total_trips, 0) + 1 WHERE id = driver_id;
END;
$$;

-- find_nearest_available_drivers RPC
CREATE OR REPLACE FUNCTION find_nearest_available_drivers(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 100,
    p_limit INT DEFAULT 5
)
RETURNS TABLE(id UUID, name TEXT, distance_km DOUBLE PRECISION) AS $$
BEGIN
    RETURN QUERY
    SELECT d.id, d.name,
        (6371 * acos(
            cos(radians(p_lat)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(d.current_lat))
        )) AS distance_km
    FROM drivers d
    WHERE d.is_available = TRUE
      AND d.current_lat IS NOT NULL AND d.current_lng IS NOT NULL
      AND (6371 * acos(
            cos(radians(p_lat)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(d.current_lat))
          )) <= p_radius_km
    ORDER BY distance_km ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- try_assign_driver RPC (advisory lock for race-free driver assignment)
CREATE OR REPLACE FUNCTION try_assign_driver(p_driver_id UUID, p_booking_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_lock_acquired BOOLEAN;
BEGIN
    v_lock_acquired := pg_try_advisory_xact_lock(('x' || translate(p_driver_id::text, '-', ''))::bit(64)::bigint);
    IF NOT v_lock_acquired THEN RETURN FALSE; END IF;
    IF NOT EXISTS (SELECT 1 FROM drivers WHERE id = p_driver_id AND is_available = TRUE) THEN
        RETURN FALSE;
    END IF;
    UPDATE drivers  SET is_available = FALSE WHERE id = p_driver_id;
    UPDATE bookings SET driver_id = p_driver_id WHERE id = p_booking_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- find_nearby_equipment RPC (Haversine radius search)
CREATE OR REPLACE FUNCTION find_nearby_equipment(
    p_lat       DOUBLE PRECISION,
    p_lng       DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 50
)
RETURNS SETOF equipment LANGUAGE sql STABLE AS $$
    SELECT * FROM equipment
    WHERE is_approved = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND (6371 * acos(LEAST(1.0,
            cos(radians(p_lat)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(latitude))
          ))) <= p_radius_km
    ORDER BY (6371 * acos(LEAST(1.0,
            cos(radians(p_lat)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(latitude))
          ))) ASC
    LIMIT 100;
$$;

-- search_equipment RPC (text + geo combined)
CREATE OR REPLACE FUNCTION search_equipment(
    p_q         TEXT    DEFAULT NULL,
    p_type      TEXT    DEFAULT NULL,
    p_pincode   TEXT    DEFAULT NULL,
    p_district  TEXT    DEFAULT NULL,
    p_lat       DOUBLE PRECISION DEFAULT NULL,
    p_lng       DOUBLE PRECISION DEFAULT NULL,
    p_radius_km DOUBLE PRECISION DEFAULT 50,
    p_min_price NUMERIC DEFAULT NULL,
    p_max_price NUMERIC DEFAULT NULL,
    p_limit     INTEGER DEFAULT 40,
    p_offset    INTEGER DEFAULT 0
)
RETURNS SETOF equipment LANGUAGE sql STABLE AS $$
    SELECT * FROM equipment
    WHERE is_approved = true AND status = 'available'
      AND (p_pincode   IS NULL OR pincode  ILIKE p_pincode)
      AND (p_district  IS NULL OR district ILIKE '%' || p_district || '%')
      AND (p_type      IS NULL OR type     ILIKE '%' || p_type || '%')
      AND (p_min_price IS NULL OR price_per_day >= p_min_price)
      AND (p_max_price IS NULL OR price_per_day <= p_max_price)
      AND (p_q IS NULL OR (
            name ILIKE '%' || p_q || '%' OR description ILIKE '%' || p_q || '%' OR
            village ILIKE '%' || p_q || '%' OR town ILIKE '%' || p_q || '%' OR
            district ILIKE '%' || p_q || '%'
      ))
      AND (p_lat IS NULL OR p_lng IS NULL OR latitude IS NULL OR longitude IS NULL OR
            (6371 * acos(LEAST(1.0,
                cos(radians(p_lat)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(p_lng)) +
                sin(radians(p_lat)) * sin(radians(latitude))
            ))) <= p_radius_km
      )
    ORDER BY
        CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
            THEN (6371 * acos(LEAST(1.0,
                cos(radians(p_lat)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(p_lng)) +
                sin(radians(p_lat)) * sin(radians(latitude))
            ))) ELSE 99999 END ASC,
        avg_rating DESC NULLS LAST,
        created_at DESC
    LIMIT p_limit OFFSET p_offset;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 5: INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_equipment_owner          ON equipment(owner_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_equipment_status         ON equipment(status); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_equipment_pincode        ON equipment(pincode) WHERE pincode IS NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_equipment_district       ON equipment(district) WHERE district IS NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_equipment_status_approved ON equipment(status, is_approved); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_equipment_lat_lng        ON equipment(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_bookings_renter          ON bookings(renter_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_bookings_owner           ON bookings(owner_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_bookings_status          ON bookings(status); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_bookings_equip           ON bookings(equipment_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_bookings_driver          ON bookings(driver_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_bookings_pay_status      ON bookings(payment_status); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_payments_booking         ON payments(booking_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_locations_equip          ON locations(equipment_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_reviews_equipment        ON reviews(equipment_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_messages_booking         ON messages(booking_id, created_at ASC); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_messages_chat_id         ON messages(chat_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_kyc_user                 ON kyc_documents(user_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_kyc_status               ON kyc_documents(status); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_disputes_booking         ON disputes(booking_id); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_disputes_status          ON disputes(status); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 6: ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN ALTER TABLE chats ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "chats_participants" ON chats FOR ALL USING (farmer_id=auth.uid() OR owner_id=auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE equipment_tracking ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "tracking_owner_write" ON equipment_tracking FOR INSERT WITH CHECK (equipment_id IN (SELECT id FROM equipment WHERE owner_id=auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "tracking_read_all"    ON equipment_tracking FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "refresh_tokens_deny_all" ON refresh_tokens FOR ALL USING (false); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE favorites ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "favorites_own" ON favorites FOR ALL USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- ✅ Done! All tables, columns, constraints, RPCs, and indexes are now in place.
-- Restart the FarmRent server so the Supabase schema cache refreshes.
-- =============================================================================
