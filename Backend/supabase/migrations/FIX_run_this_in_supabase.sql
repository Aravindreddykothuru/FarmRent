-- ═══════════════════════════════════════════════════════════════════════════
-- FarmRent — ONE-TIME FIX
-- Run in Supabase Dashboard → SQL Editor → New Query → Run
-- Every block is wrapped in its own DO $$ ... $$ so one failure never
-- stops the rest. Re-run safe: all statements use IF NOT EXISTS guards.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. Auth columns on users ─────────────────────────────────────────────────
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
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode               TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS town                  TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS village               TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status            TEXT DEFAULT 'unverified'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_email_verify_token   ON users (email_verify_token)   WHERE email_verify_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users (password_reset_token) WHERE password_reset_token IS NOT NULL;

-- ── 2. refresh_tokens table ───────────────────────────────────────────────────
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

DO $$ BEGIN
  ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "refresh_tokens_deny_all" ON refresh_tokens FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. payments — add user_id if missing, fix FK ──────────────────────────────
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id UUID; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
DECLARE _cname TEXT;
BEGIN
  -- drop FK to auth.users if it exists
  SELECT conname INTO _cname FROM pg_constraint
   WHERE conrelid='payments'::regclass AND contype='f'
     AND confrelid='auth.users'::regclass LIMIT 1;
  IF _cname IS NOT NULL THEN EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', _cname); END IF;

  -- drop FK to public.users if it exists (avoid duplicate)
  SELECT conname INTO _cname FROM pg_constraint
   WHERE conrelid='payments'::regclass AND contype='f'
     AND confrelid='public.users'::regclass LIMIT 1;
  IF _cname IS NOT NULL THEN EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', _cname); END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_id          UUID;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount              NUMERIC(10,2); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS method              TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_id      TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_id           TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at         TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_amount_paise INTEGER;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_reason       TEXT;        EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── 4. chats table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    farmer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (equipment_id, farmer_id)
);

DO $$ BEGIN ALTER TABLE chats ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "chats_participants" ON chats FOR ALL USING (farmer_id=auth.uid() OR owner_id=auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. messages — extra columns ───────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_id      UUID REFERENCES chats(id) ON DELETE CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image')); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name  TEXT; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── 6. equipment_tracking table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_tracking (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    timestamp    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_tracking_equipment ON equipment_tracking (equipment_id, timestamp DESC);

DO $$ BEGIN ALTER TABLE equipment_tracking ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "tracking_owner_write" ON equipment_tracking FOR INSERT WITH CHECK (equipment_id IN (SELECT id FROM equipment WHERE owner_id=auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "tracking_read_all" ON equipment_tracking FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 7. equipment extra columns ────────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pincode      TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS town         TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS village      TEXT;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS avg_rating   NUMERIC(3,2) DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── 8. bookings extra columns ─────────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS geofence_radius_km NUMERIC(6,2) DEFAULT 50; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── 9. marketplace tables ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, equipment_id)
);

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
    status                VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered','expired')),
    counter_price         NUMERIC(10,2),
    counter_message       TEXT,
    booking_id            UUID REFERENCES bookings(id) ON DELETE SET NULL,
    expires_at            TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_searches (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(200) NOT NULL,
    filters    JSONB NOT NULL DEFAULT '{}',
    alert_on   BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN ALTER TABLE favorites ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "favorites_own" ON favorites FOR ALL USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 10. kyc_documents ────────────────────────────────────────────────────────
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

-- ── 11. disputes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id    UUID REFERENCES bookings(id) ON DELETE CASCADE,
    raised_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    type          TEXT NOT NULL CHECK (type IN ('equipment_damage','non_return','payment_dispute','service_issue','other')),
    description   TEXT NOT NULL,
    evidence_urls TEXT[] DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved_farmer','resolved_owner','closed')),
    admin_notes   TEXT,
    resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 12. indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_equipment_owner      ON equipment(owner_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status     ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_pincode    ON equipment(pincode);
CREATE INDEX IF NOT EXISTS idx_bookings_renter      ON bookings(renter_id);
CREATE INDEX IF NOT EXISTS idx_bookings_owner       ON bookings(owner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status      ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_equip       ON bookings(equipment_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking     ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_locations_equip      ON locations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_reviews_equipment    ON reviews(equipment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_booking     ON messages(booking_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id     ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_kyc_user             ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status           ON kyc_documents(status);
CREATE INDEX IF NOT EXISTS idx_disputes_booking     ON disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status      ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_favorites_user       ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_equip      ON favorites(equipment_id);
CREATE INDEX IF NOT EXISTS idx_offers_renter        ON offers(renter_id);
CREATE INDEX IF NOT EXISTS idx_offers_owner         ON offers(owner_id);
CREATE INDEX IF NOT EXISTS idx_offers_equipment     ON offers(equipment_id);
CREATE INDEX IF NOT EXISTS idx_offers_status        ON offers(status);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user  ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_farmer_id      ON chats(farmer_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner_id       ON chats(owner_id);
CREATE INDEX IF NOT EXISTS idx_chats_equipment_id   ON chats(equipment_id);

-- ── 13. updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ BEGIN CREATE TRIGGER trg_users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_equip_updated_at    BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON bookings  FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON disputes  FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_offers_updated_at   BEFORE UPDATE ON offers    FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 14. Fix payments status CHECK (add 'refunded') ───────────────────────────
DO $$
BEGIN
  ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
  ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 15. bookings extra columns (COD flow, lifecycle, driver assignment) ────────
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

-- ── 16. Fix bookings status CHECK (add 'requested', 'in_progress') ────────────
DO $$
BEGIN
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('requested', 'pending', 'accepted', 'confirmed', 'in_progress', 'completed', 'cancelled'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 17. drivers table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
    name            TEXT        NOT NULL,
    phone           TEXT        NOT NULL,
    license_number  TEXT,
    vehicle_type    TEXT,
    vehicle_number  TEXT,
    current_lat     DOUBLE PRECISION,
    current_lng     DOUBLE PRECISION,
    is_available    BOOLEAN     NOT NULL DEFAULT TRUE,
    rating          NUMERIC(3,2) DEFAULT 0,
    total_trips     INT         DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers(is_available) WHERE is_available = TRUE;
CREATE INDEX IF NOT EXISTS idx_drivers_user      ON drivers(user_id);

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_driver_id_fkey
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 18. promo_codes table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT        NOT NULL UNIQUE,
    description     TEXT,
    discount_type   TEXT        NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'flat')),
    discount_value  NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(10,2) DEFAULT 0,
    max_discount    NUMERIC(10,2),
    usage_limit     INT,
    used_count      INT         NOT NULL DEFAULT 0,
    valid_from      TIMESTAMPTZ DEFAULT NOW(),
    valid_until     TIMESTAMPTZ,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code   ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active) WHERE is_active = TRUE;

-- ── 19. find_nearest_available_drivers RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION find_nearest_available_drivers(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 100,
    p_limit INT DEFAULT 5
)
RETURNS TABLE(id UUID, name TEXT, distance_km DOUBLE PRECISION) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.name,
        (6371 * acos(
            cos(radians(p_lat)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(d.current_lat))
        )) AS distance_km
    FROM drivers d
    WHERE d.is_available = TRUE
      AND d.current_lat IS NOT NULL
      AND d.current_lng IS NOT NULL
      AND (6371 * acos(
            cos(radians(p_lat)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(d.current_lat))
          )) <= p_radius_km
    ORDER BY distance_km ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ── 20. try_assign_driver RPC (advisory lock for race-free assignment) ─────────
CREATE OR REPLACE FUNCTION try_assign_driver(p_driver_id UUID, p_booking_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_lock_acquired BOOLEAN;
BEGIN
    -- Advisory lock on driver UUID (bigint representation)
    v_lock_acquired := pg_try_advisory_xact_lock(('x' || translate(p_driver_id::text, '-', ''))::bit(64)::bigint);
    IF NOT v_lock_acquired THEN RETURN FALSE; END IF;

    -- Re-check availability inside lock
    IF NOT EXISTS (SELECT 1 FROM drivers WHERE id = p_driver_id AND is_available = TRUE) THEN
        RETURN FALSE;
    END IF;

    -- Mark driver busy and link to booking
    UPDATE drivers  SET is_available = FALSE WHERE id = p_driver_id;
    UPDATE bookings SET driver_id = p_driver_id WHERE id = p_booking_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ── 21. bookings indexes (new columns) ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_driver      ON bookings(driver_id);
CREATE INDEX IF NOT EXISTS idx_bookings_pay_status  ON bookings(payment_status);

-- ── Done — all tables, columns, constraints, and RPCs are now in place ─────────
