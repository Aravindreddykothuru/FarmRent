-- =============================================================================
-- 0001_baseline.sql — canonical FarmRent schema
--
-- Source of truth for every table/column/RPC the Express backend reads or writes.
-- Replaces the historical, mutually inconsistent scripts kept in db/legacy/.
--
-- Written to be safe on:
--   * an empty database (local Docker stack, CI), and
--   * an existing Supabase project that ran some of the legacy scripts
--     (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS; no DROP TABLE).
--
-- Expects the Supabase API roles (anon, authenticated, service_role) to exist —
-- Supabase provides them; locally infra/local/db-init creates them.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

-- ── Users & roles ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL UNIQUE,
    phone          TEXT UNIQUE,
    password_hash  TEXT NOT NULL,
    full_name      TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status     TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE users ADD COLUMN IF NOT EXISTS village        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS town           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS district       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS state          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS roles (
    id   SMALLINT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Canonical role vocabulary shared by the JWT, requireRole() guards and the frontend.
-- Temporarily rename first so re-assigning names across ids never trips the UNIQUE constraint
-- (earlier code rewrote these rows at runtime, so existing databases may have them shuffled).
UPDATE roles SET name = '__tmp_role_' || id WHERE id IN (1, 2, 3, 4, 5);
INSERT INTO roles (id, name) VALUES
    (1, 'farmer'), (2, 'buyer'), (3, 'owner'), (4, 'admin'), (5, 'driver')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);
-- The removed profile "switch role" bug mapped owner -> role 2; registration never assigns role 2.
INSERT INTO user_roles (user_id, role_id)
    SELECT user_id, 3 FROM user_roles WHERE role_id = 2
ON CONFLICT DO NOTHING;
DELETE FROM user_roles WHERE role_id = 2;

CREATE TABLE IF NOT EXISTS user_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id   TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS user_addresses (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city          TEXT NOT NULL,
    state         TEXT NOT NULL,
    pincode       VARCHAR(10) NOT NULL,
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses (user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    email      BOOLEAN NOT NULL DEFAULT TRUE,
    sms        BOOLEAN NOT NULL DEFAULT TRUE,
    push       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Equipment ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'other',
    daily_rate  NUMERIC(12,2) NOT NULL CHECK (daily_rate > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS price_weekly      NUMERIC(12,2);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS price_monthly     NUMERIC(12,2);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS deposit_amount    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS brand             TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS horsepower        INTEGER;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS year_of_mfg       INTEGER;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS condition         TEXT NOT NULL DEFAULT 'good';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS images            TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS is_verified       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS is_available      BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS is_deleted        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS latitude          DOUBLE PRECISION;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS longitude         DOUBLE PRECISION;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS location_point    GEOGRAPHY(POINT, 4326);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS address_full      TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS village           TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS town              TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS district          TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS state             TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pincode           TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC NOT NULL DEFAULT 50;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS service_pincodes  TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pickup_lat        DOUBLE PRECISION;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pickup_lng        DOUBLE PRECISION;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pickup_address    TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pickup_landmark   TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS features          TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS specifications    JSONB NOT NULL DEFAULT '{}';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS operator_included BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS avg_rating        NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS rating_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS review_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_status_check') THEN
        ALTER TABLE equipment ADD CONSTRAINT equipment_status_check
            CHECK (status IN ('active', 'inactive', 'maintenance'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_equipment_owner      ON equipment (owner_id);
CREATE INDEX IF NOT EXISTS idx_equipment_listing    ON equipment (status, is_verified, created_at DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_equipment_category   ON equipment (category);
CREATE INDEX IF NOT EXISTS idx_equipment_pincode    ON equipment (pincode);
CREATE INDEX IF NOT EXISTS idx_equipment_district   ON equipment (district);
CREATE INDEX IF NOT EXISTS idx_equipment_location   ON equipment USING GIST (location_point);

-- Keep the geography column derived from lat/lng so callers never write WKT by hand.
CREATE OR REPLACE FUNCTION equipment_sync_location_point() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location_point := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    ELSE
        NEW.location_point := NULL;
    END IF;
    RETURN NEW;
END
$$;

-- ── Drivers ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drivers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_number   TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_name     TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_type     TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_number   TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_lat      DOUBLE PRECISION;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_lng      DOUBLE PRECISION;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS heading          DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS speed            DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_available     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_sharing BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rating           NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS total_trips      INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS drivers_user_id_key ON drivers (user_id);
CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers (is_available) WHERE is_available;

-- ── Rentals (bookings) ───────────────────────────────────────────────────────
-- Lifecycle: requested -> approved | rejected | cancelled
--            approved  -> active | cancelled
--            active    -> return_pending | completed
--            return_pending -> completed
-- Transitions and who may trigger them are enforced in services/booking-service/lifecycle.js.

CREATE TABLE IF NOT EXISTS equipment_rentals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
    renter_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'requested',
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    total_days   INTEGER GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
    daily_rate   NUMERIC(12,2) NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_dates CHECK (end_date >= start_date)
);
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS owner_notes         TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS pickup_location     TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS return_location     TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS payment_method      TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS payment_status      TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS driver_id           UUID REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS pickup_lat          DOUBLE PRECISION;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS pickup_lng          DOUBLE PRECISION;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS dropoff_lat         DOUBLE PRECISION;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS dropoff_lng         DOUBLE PRECISION;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS distance_km         NUMERIC(10,2);
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS eta_minutes         INTEGER;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS route_geometry      TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS geofence_radius_km  NUMERIC(6,2) NOT NULL DEFAULT 50;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS invoice_url         TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS accepted_at         TIMESTAMPTZ;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMPTZ;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS started_at          TIMESTAMPTZ;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS return_requested_at TIMESTAMPTZ;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS delivery_mode       TEXT NOT NULL DEFAULT 'pickup';
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS field_address       TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS promo_code          TEXT;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS service_fee         NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS deposit_amount      NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS delivery_charge     NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    ALTER TABLE equipment_rentals DROP CONSTRAINT IF EXISTS equipment_rentals_status_check;
    ALTER TABLE equipment_rentals ADD CONSTRAINT equipment_rentals_status_check
        CHECK (status IN ('requested', 'approved', 'rejected', 'active', 'return_pending',
                          'completed', 'cancelled', 'disputed'));

    ALTER TABLE equipment_rentals DROP CONSTRAINT IF EXISTS equipment_rentals_payment_status_check;
    ALTER TABLE equipment_rentals ADD CONSTRAINT equipment_rentals_payment_status_check
        CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed'));

    ALTER TABLE equipment_rentals DROP CONSTRAINT IF EXISTS equipment_rentals_amounts_check;
    ALTER TABLE equipment_rentals ADD CONSTRAINT equipment_rentals_amounts_check
        CHECK (daily_rate >= 0 AND total_amount >= 0);

    -- Double-booking guard: two live rentals of the same machine may never share a day.
    -- Enforced by Postgres, so it holds under concurrent requests and for every code path.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_rentals_no_overlap') THEN
        ALTER TABLE equipment_rentals ADD CONSTRAINT equipment_rentals_no_overlap
            EXCLUDE USING gist (
                equipment_id WITH =,
                daterange(start_date, end_date, '[]') WITH &&
            ) WHERE (status IN ('requested', 'approved', 'active', 'return_pending'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_rentals_renter    ON equipment_rentals (renter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rentals_owner     ON equipment_rentals (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rentals_equipment ON equipment_rentals (equipment_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_driver    ON equipment_rentals (driver_id);

CREATE TABLE IF NOT EXISTS booking_extension_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id   UUID NOT NULL REFERENCES equipment_rentals(id) ON DELETE CASCADE,
    new_end_date DATE NOT NULL,
    extra_amount NUMERIC(12,2) NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_extensions_booking ON booking_extension_requests (booking_id);

-- ── Payments ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_id       UUID NOT NULL,
    reference_type     TEXT NOT NULL DEFAULT 'rental' CHECK (reference_type IN ('order', 'rental')),
    payer_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    payee_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    gateway            TEXT NOT NULL DEFAULT 'razorpay',
    gateway_order_id   TEXT UNIQUE,
    gateway_payment_id TEXT UNIQUE,
    idempotency_key    TEXT NOT NULL UNIQUE,
    amount             NUMERIC(12,2) NOT NULL,
    currency           TEXT NOT NULL DEFAULT 'INR',
    status             TEXT NOT NULL DEFAULT 'created'
                       CHECK (status IN ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
    failure_reason     TEXT,
    refund_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    metadata           JSONB NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments (reference_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer     ON payments (payer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    success             BOOLEAN NOT NULL,
    message             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    label           TEXT,
    description     TEXT,
    discount_type   TEXT NOT NULL DEFAULT 'flat' CHECK (discount_type IN ('percent', 'flat')),
    discount_value  NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    min_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_discount    NUMERIC(10,2),
    usage_limit     INTEGER,
    used_count      INTEGER NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Engagement: reviews, favourites, offers, saved searches ─────────────────

CREATE TABLE IF NOT EXISTS reviews (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id   UUID UNIQUE REFERENCES equipment_rentals(id) ON DELETE CASCADE,
    equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
    reviewer_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_equipment ON reviews (equipment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS favorites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, equipment_id)
);

CREATE TABLE IF NOT EXISTS offers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id          UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    renter_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offered_price_per_day NUMERIC(10,2) NOT NULL CHECK (offered_price_per_day > 0),
    start_date            DATE NOT NULL,
    end_date              DATE NOT NULL,
    message               TEXT,
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'expired')),
    counter_price         NUMERIC(10,2),
    counter_message       TEXT,
    booking_id            UUID REFERENCES equipment_rentals(id) ON DELETE SET NULL,
    expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT offers_valid_dates CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_offers_renter ON offers (renter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_owner  ON offers (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS saved_searches (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(200) NOT NULL,
    filters    JSONB NOT NULL DEFAULT '{}',
    alert_on   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches (user_id);

-- ── Messaging & notifications ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chats (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    farmer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id   UUID REFERENCES equipment_rentals(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (equipment_id, farmer_id)
);
CREATE INDEX IF NOT EXISTS idx_chats_farmer ON chats (farmer_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner  ON chats (owner_id);

CREATE TABLE IF NOT EXISTS messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    content      TEXT NOT NULL,
    is_read      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_id      UUID REFERENCES chats(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS booking_id   UUID REFERENCES equipment_rentals(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name  TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
CREATE INDEX IF NOT EXISTS idx_messages_chat    ON messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages (booking_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'system',
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    data       JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

-- ── Trust & safety: KYC, disputes ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyc_documents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type         TEXT NOT NULL CHECK (doc_type IN ('aadhar', 'driving_license', 'farm_proof', 'gst')),
    file_url         TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_documents (user_id);

CREATE TABLE IF NOT EXISTS disputes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id    UUID REFERENCES equipment_rentals(id) ON DELETE CASCADE,
    raised_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    type          TEXT NOT NULL CHECK (type IN ('equipment_damage', 'non_return', 'payment_dispute', 'service_issue', 'other')),
    description   TEXT NOT NULL,
    evidence_urls TEXT[] NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'under_review', 'resolved_farmer', 'resolved_owner', 'closed')),
    admin_notes   TEXT,
    resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disputes_booking ON disputes (booking_id);

-- ── GPS tracking ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gps_locations (
    id           BIGSERIAL PRIMARY KEY,
    equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
    rental_id    UUID REFERENCES equipment_rentals(id) ON DELETE SET NULL,
    location     GEOGRAPHY(POINT, 4326),
    altitude     DOUBLE PRECISION,
    speed_kmh    DOUBLE PRECISION,
    heading      DOUBLE PRECISION,
    accuracy     DOUBLE PRECISION,
    recorded_at  TIMESTAMPTZ NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gps_rental_time ON gps_locations (rental_id, recorded_at);

CREATE TABLE IF NOT EXISTS equipment_locations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id  UUID REFERENCES equipment(id) ON DELETE CASCADE,
    booking_id    UUID REFERENCES equipment_rentals(id) ON DELETE CASCADE,
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL,
    accuracy      DOUBLE PRECISION,
    speed         DOUBLE PRECISION,
    heading       DOUBLE PRECISION,
    altitude      DOUBLE PRECISION,
    source        TEXT NOT NULL DEFAULT 'mobile_gps',
    device_id     TEXT,
    battery_level INTEGER,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_locations_booking ON equipment_locations (booking_id, updated_at DESC);

-- ── Triggers ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'user_sessions', 'user_addresses', 'notification_preferences',
                             'equipment', 'drivers', 'equipment_rentals', 'booking_extension_requests',
                             'payments', 'offers', 'disputes']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', t);
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
                        FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END LOOP;
END
$$;

DROP TRIGGER IF EXISTS trg_equipment_location_point ON equipment;
CREATE TRIGGER trg_equipment_location_point
    BEFORE INSERT OR UPDATE OF latitude, longitude ON equipment
    FOR EACH ROW EXECUTE FUNCTION equipment_sync_location_point();

-- ── RPCs used by the backend ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION compute_equipment_avg_rating(p_equipment_id UUID) RETURNS VOID
LANGUAGE sql AS $$
    UPDATE equipment e SET
        avg_rating   = COALESCE(s.avg, 0),
        rating_count = s.cnt,
        review_count = s.cnt
    FROM (SELECT AVG(rating)::NUMERIC(3,2) AS avg, COUNT(*)::INTEGER AS cnt
          FROM reviews WHERE equipment_id = p_equipment_id) s
    WHERE e.id = p_equipment_id;
$$;

CREATE OR REPLACE FUNCTION drivers_increment_trips(driver_id UUID) RETURNS VOID
LANGUAGE sql AS $$
    UPDATE drivers SET total_trips = total_trips + 1 WHERE id = driver_id;
$$;

DROP FUNCTION IF EXISTS find_nearest_available_drivers(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER);
CREATE FUNCTION find_nearest_available_drivers(
    p_lat       DOUBLE PRECISION,
    p_lng       DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 100,
    p_limit     INTEGER DEFAULT 5
) RETURNS TABLE (id UUID, name TEXT, distance_km DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT d.id, d.name,
           ST_Distance(ST_MakePoint(d.current_lng, d.current_lat)::geography,
                       ST_MakePoint(p_lng, p_lat)::geography) / 1000.0 AS distance_km
    FROM drivers d
    WHERE d.is_available
      AND d.current_lat IS NOT NULL AND d.current_lng IS NOT NULL
      AND ST_DWithin(ST_MakePoint(d.current_lng, d.current_lat)::geography,
                     ST_MakePoint(p_lng, p_lat)::geography, p_radius_km * 1000)
    ORDER BY distance_km
    LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS try_assign_driver(UUID, UUID);
CREATE FUNCTION try_assign_driver(p_driver_id UUID, p_booking_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
    -- Row lock serialises concurrent assignment attempts for the same driver.
    PERFORM 1 FROM drivers WHERE id = p_driver_id AND is_available FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    UPDATE drivers SET is_available = FALSE WHERE id = p_driver_id;
    UPDATE equipment_rentals SET driver_id = p_driver_id WHERE id = p_booking_id;
    RETURN TRUE;
END
$$;

DROP FUNCTION IF EXISTS find_nearby_equipment(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);
CREATE FUNCTION find_nearby_equipment(
    p_lat       DOUBLE PRECISION,
    p_lng       DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 50
) RETURNS SETOF equipment
LANGUAGE sql STABLE AS $$
    SELECT e.*
    FROM equipment e
    WHERE e.is_verified AND NOT e.is_deleted AND e.status = 'active'
      AND e.location_point IS NOT NULL
      AND ST_DWithin(e.location_point, ST_MakePoint(p_lng, p_lat)::geography, p_radius_km * 1000)
    ORDER BY ST_Distance(e.location_point, ST_MakePoint(p_lng, p_lat)::geography)
    LIMIT 100;
$$;

-- Atomically counts one use of a promo code; FALSE when it is inactive, expired or exhausted.
CREATE OR REPLACE FUNCTION redeem_promo_code(p_code TEXT) RETURNS BOOLEAN
LANGUAGE sql AS $$
    WITH redeemed AS (
        UPDATE promo_codes
        SET used_count = used_count + 1
        WHERE code = p_code
          AND is_active
          AND (usage_limit IS NULL OR used_count < usage_limit)
          AND (expires_at IS NULL OR expires_at > now())
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM redeemed);
$$;

DO $$
BEGIN
    ALTER TABLE equipment_rentals DROP CONSTRAINT IF EXISTS equipment_rentals_delivery_mode_check;
    ALTER TABLE equipment_rentals ADD CONSTRAINT equipment_rentals_delivery_mode_check
        CHECK (delivery_mode IN ('pickup', 'delivery'));
END
$$;

-- ── Access control ───────────────────────────────────────────────────────────
-- The backend is the only database client and connects as service_role (bypasses RLS).
-- RLS with no policies denies the public anon/authenticated roles on every table, so the
-- anon key shipped to browsers cannot read or write application data through PostgREST.

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'roles', 'user_roles', 'user_sessions', 'user_addresses',
                             'notification_preferences', 'equipment', 'drivers', 'equipment_rentals',
                             'booking_extension_requests', 'payments', 'payments_log', 'promo_codes',
                             'reviews', 'favorites', 'offers', 'saved_searches', 'chats', 'messages',
                             'notifications', 'kyc_documents', 'disputes', 'gps_locations',
                             'equipment_locations']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
