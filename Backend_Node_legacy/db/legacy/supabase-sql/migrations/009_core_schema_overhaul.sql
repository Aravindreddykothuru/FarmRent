-- =============================================================================
-- Migration: 009_core_schema_overhaul.sql
-- Overhauls database schema to support new core models and RLS policies.
-- =============================================================================

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop existing tables with CASCADE to allow fresh overrides
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS kyc_documents CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS favorites CASCADE;
DROP TABLE IF EXISTS saved_searches CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS chats CASCADE;
DROP TABLE IF EXISTS equipment_tracking CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS gps_locations CASCADE;
DROP TABLE IF EXISTS equipment_rentals CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS payments_log CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS product_images CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS addresses CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS otp_verifications CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS drivers CASCADE;
DROP TABLE IF EXISTS promo_codes CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ── 1. USERS & AUTH ─────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT UNIQUE,
  password_hash TEXT NOT NULL,          -- bcrypt cost 12
  full_name     TEXT NOT NULL,
  avatar_url    TEXT,
  status        TEXT DEFAULT 'active'
                CHECK (status IN ('active','suspended','banned','pending_verification')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ,             -- soft delete
  -- back-compat fields for registration validation:
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  email_verify_token TEXT,
  email_verify_expiry TIMESTAMPTZ,
  password_reset_token TEXT,
  password_reset_expiry TIMESTAMPTZ,
  phone_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  phone_otp_hash  TEXT,
  phone_otp_expiry TIMESTAMPTZ,
  kyc_status      TEXT DEFAULT 'unverified'
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;

CREATE TABLE roles (
  id   SMALLINT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL   -- farmer | buyer | equipment_owner | admin
);

CREATE TABLE user_roles (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE otp_verifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  otp_hash   TEXT NOT NULL,
  purpose    TEXT NOT NULL     -- register | login | forgot_password
             CHECK (purpose IN ('register','login','forgot_password')),
  attempts   SMALLINT DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_otp_email_purpose ON otp_verifications(email, purpose)
  WHERE used_at IS NULL;

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  device_id   TEXT,
  ip_address  INET,
  user_agent  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_rt_user_id ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- ── 2. ADDRESSES ─────────────────────────────────────────────────────────────

CREATE TABLE addresses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  line1      TEXT,
  line2      TEXT,
  city       TEXT,
  state      TEXT,
  pincode    TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 3. PRODUCTS & MARKETPLACE (CROPS) ────────────────────────────────────────

CREATE TABLE categories (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  slug      TEXT UNIQUE NOT NULL,
  parent_id UUID REFERENCES categories(id),
  icon_url  TEXT,
  sort_order SMALLINT DEFAULT 0
);

CREATE TABLE products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE NOT NULL,
  description  TEXT,
  price        NUMERIC(12,2) NOT NULL CHECK (price > 0),
  unit         TEXT NOT NULL,         -- kg | litre | piece | dozen
  stock_qty    INTEGER DEFAULT 0 CHECK (stock_qty >= 0),
  min_order    INTEGER DEFAULT 1,
  status       TEXT DEFAULT 'draft'
               CHECK (status IN ('draft','active','paused','out_of_stock')),
  is_featured  BOOLEAN DEFAULT false,
  search_vec   TSVECTOR,              -- full-text search vector
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX idx_products_farmer ON products(farmer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_search ON products USING GIN(search_vec);
CREATE INDEX idx_products_price ON products(price) WHERE status='active';

CREATE TABLE product_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  cdn_url    TEXT NOT NULL,
  sort_order SMALLINT DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger to keep search_vec fresh
CREATE OR REPLACE FUNCTION update_product_search() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vec := to_tsvector('english', 
    coalesce(NEW.name,'') || ' ' || coalesce(NEW.description,''));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_product_search BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_product_search();

-- ── 4. ORDERS & PAYMENTS (CROPS / SERVICES) ───────────────────────────────

CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  farmer_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','packed',
                                    'shipped','delivered','cancelled','returned')),
  total_amount    NUMERIC(12,2) NOT NULL,
  shipping_amount NUMERIC(12,2) DEFAULT 0,
  delivery_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
  tracking_number TEXT,
  notes           TEXT,
  cancelled_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_orders_buyer ON orders(buyer_id, created_at DESC);
CREATE INDEX idx_orders_farmer ON orders(farmer_id, status);
CREATE INDEX idx_orders_status ON orders(status, created_at DESC);

CREATE TABLE order_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  total_price NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id       UUID NOT NULL,       -- order_id or rental_id
  reference_type     TEXT NOT NULL        -- order | rental
                     CHECK (reference_type IN ('order','rental')),
  payer_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  payee_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  gateway            TEXT DEFAULT 'razorpay',
  gateway_order_id   TEXT UNIQUE,
  gateway_payment_id TEXT UNIQUE,
  idempotency_key    TEXT UNIQUE NOT NULL, -- client-supplied, prevents double charge
  amount             NUMERIC(12,2) NOT NULL,
  currency           TEXT DEFAULT 'INR',
  status             TEXT DEFAULT 'created'
                     CHECK (status IN ('created','authorized','captured',
                                       'failed','refunded','partially_refunded')),
  failure_reason     TEXT,
  refund_amount      NUMERIC(12,2) DEFAULT 0,
  metadata           JSONB DEFAULT '{}',
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- ── 5. EQUIPMENT RENTAL ─────────────────────────────────────────────────────

CREATE TABLE equipment (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  category          TEXT NOT NULL    -- tractor | harvester | seeder | drone | ...
                    CHECK (category IN ('tractor','harvester','seeder','drone','plow','baler','sprayer','other')),
  name              TEXT NOT NULL,
  description       TEXT,
  daily_rate        NUMERIC(12,2) NOT NULL CHECK (daily_rate > 0),
  deposit_amount    NUMERIC(12,2) DEFAULT 0,
  location_point    GEOGRAPHY(POINT, 4326),  -- PostGIS for geospatial queries
  location_district TEXT,
  location_state    TEXT,
  year_of_mfg       INTEGER,
  condition         TEXT DEFAULT 'good'
                    CHECK (condition IN ('excellent','good','fair')),
  is_verified       BOOLEAN DEFAULT false,
  is_available      BOOLEAN DEFAULT true,
  status            TEXT DEFAULT 'active'
                    CHECK (status IN ('active','inactive','maintenance')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  -- Extra back-compat helper columns to prevent nextfrontend UI breaks:
  images            TEXT[] DEFAULT '{}',
  avg_rating        NUMERIC(3,2) DEFAULT 0,
  rating_count      INTEGER DEFAULT 0,
  review_count      INTEGER DEFAULT 0,
  pincode           VARCHAR(6),
  village           TEXT,
  town              TEXT,
  service_radius_km NUMERIC DEFAULT 50,
  service_pincodes  TEXT[] DEFAULT '{}',
  address_full      TEXT,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION
);
CREATE INDEX idx_equipment_location ON equipment USING GIST(location_point);
CREATE INDEX idx_equipment_category ON equipment(category) WHERE is_available=true;

CREATE TABLE equipment_rentals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id     UUID REFERENCES equipment(id) ON DELETE SET NULL,
  renter_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT DEFAULT 'requested'
                   CHECK (status IN ('requested','approved','active',
                                     'completed','cancelled','disputed')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  total_days       INTEGER GENERATED ALWAYS AS 
                   (end_date - start_date + 1) STORED,
  daily_rate       NUMERIC(12,2) NOT NULL,
  total_amount     NUMERIC(12,2) NOT NULL,
  pickup_location  TEXT,
  return_location  TEXT,
  owner_notes      TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  -- Extra back-compat columns:
  payment_method   TEXT DEFAULT 'razorpay',
  payment_status   TEXT DEFAULT 'pending',
  driver_id        UUID, -- references drivers(id) added below
  pickup_lat       DOUBLE PRECISION,
  pickup_lng       DOUBLE PRECISION,
  dropoff_lat      DOUBLE PRECISION,
  dropoff_lng      DOUBLE PRECISION,
  distance_km      NUMERIC(10,2),
  eta_minutes      INTEGER,
  route_geometry   TEXT,
  accepted_at      TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  geofence_radius_km NUMERIC(6,2) DEFAULT 50,
  CONSTRAINT valid_dates CHECK (end_date >= start_date)
);

-- Partitioned GPS logs
CREATE TABLE gps_locations (
  id           BIGSERIAL,
  equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
  rental_id    UUID REFERENCES equipment_rentals(id) ON DELETE SET NULL,
  location     GEOGRAPHY(POINT, 4326),
  altitude     FLOAT,
  speed_kmh    FLOAT,
  heading      FLOAT,
  accuracy     FLOAT,
  recorded_at  TIMESTAMPTZ NOT NULL,    -- from GPS device, not server
  received_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);
CREATE INDEX idx_gps_equipment_time ON gps_locations(equipment_id, recorded_at DESC);
CREATE INDEX idx_gps_location ON gps_locations USING GIST(location);

-- Recreate default partition so that inserts outside bounds never fail
CREATE TABLE gps_locations_default PARTITION OF gps_locations DEFAULT;

-- ── 6. AUXILIARY TABLES (RESTORED RELATIONSHIPS) ─────────────────────────────

CREATE TABLE IF NOT EXISTS drivers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    phone          TEXT NOT NULL,
    license_number TEXT,
    vehicle_name   TEXT,
    vehicle_type   TEXT,
    vehicle_number TEXT,
    current_lat    DOUBLE PRECISION,
    current_lng    DOUBLE PRECISION,
    is_available   BOOLEAN NOT NULL DEFAULT TRUE,
    rating         NUMERIC(3,2) DEFAULT 0,
    total_trips    INT DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers(is_available) WHERE is_available = TRUE;

-- Update FK constraint on rentals to reference drivers
ALTER TABLE equipment_rentals ADD CONSTRAINT fk_rentals_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS promo_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    description     TEXT,
    label           TEXT,
    discount_type   TEXT NOT NULL DEFAULT 'flat' CHECK (discount_type IN ('percent','flat')),
    discount_value  NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(10,2) DEFAULT 0,
    max_discount    NUMERIC(10,2),
    usage_limit     INT,
    used_count      INT NOT NULL DEFAULT 0,
    valid_until     TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id   UUID UNIQUE REFERENCES equipment_rentals(id) ON DELETE CASCADE,
    equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
    reviewer_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_equipment ON reviews(equipment_id);

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
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS favorites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

CREATE TABLE IF NOT EXISTS saved_searches (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(200) NOT NULL,
    filters    JSONB NOT NULL DEFAULT '{}',
    alert_on   BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);

CREATE TABLE IF NOT EXISTS offers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id          TEXT NOT NULL,
    renter_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offered_price_per_day NUMERIC(10,2) NOT NULL,
    start_date            DATE NOT NULL,
    end_date              DATE NOT NULL,
    message               TEXT,
    status                VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered','expired')),
    counter_price         NUMERIC(10,2),
    expires_at            TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    farmer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(equipment_id, farmer_id)
);
CREATE INDEX IF NOT EXISTS idx_chats_farmer_id ON chats(farmer_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner_id ON chats(owner_id);

CREATE TABLE IF NOT EXISTS messages (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id    UUID REFERENCES chats(id) ON DELETE CASCADE,
    sender_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_name TEXT,
    content    TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image')),
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS disputes (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id     UUID REFERENCES equipment_rentals(id) ON DELETE CASCADE,
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

-- Log table for verification attempts
CREATE TABLE IF NOT EXISTS payments_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    success             BOOLEAN NOT NULL,
    message             TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ── 7. SEED INITIAL ROLES ────────────────────────────────────────────────────

INSERT INTO roles (id, name) VALUES
  (1, 'farmer'),
  (2, 'buyer'),
  (3, 'equipment_owner'),
  (4, 'admin')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ── 8. STORED PROCEDURES & TRIGGERS ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_equip_updated_at BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rentals_updated_at BEFORE UPDATE ON equipment_rentals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- compute_equipment_avg_rating RPC
CREATE OR REPLACE FUNCTION compute_equipment_avg_rating(p_equipment_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE equipment SET
        avg_rating   = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE equipment_id = p_equipment_id),
        review_count = (SELECT COUNT(*) FROM reviews WHERE equipment_id = p_equipment_id),
        rating_count = (SELECT COUNT(*) FROM reviews WHERE equipment_id = p_equipment_id)
    WHERE id = p_equipment_id;
END;
$$;

-- drivers_increment_trips RPC
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

-- try_assign_driver RPC
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
    UPDATE equipment_rentals SET driver_id = p_driver_id WHERE id = p_booking_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- find_nearby_equipment RPC (using geography indices)
CREATE OR REPLACE FUNCTION find_nearby_equipment(
    p_lat       DOUBLE PRECISION,
    p_lng       DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 50
)
RETURNS SETOF equipment AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM equipment
    WHERE is_verified = true
      AND location_point IS NOT NULL
      AND ST_DWithin(location_point, ST_SetSRID(ST_Point(p_lng, p_lat), 4326)::geography, p_radius_km * 1000)
    ORDER BY ST_Distance(location_point, ST_SetSRID(ST_Point(p_lng, p_lat), 4326)::geography) ASC
    LIMIT 100;
END;
$$ LANGUAGE plpgsql STABLE;

-- search_equipment RPC (adapted to use location_point geography)
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
RETURNS SETOF equipment LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM equipment
    WHERE is_verified = true AND status = 'active'
      AND (p_pincode   IS NULL OR pincode  ILIKE p_pincode)
      AND (p_district  IS NULL OR district ILIKE '%' || p_district || '%')
      AND (p_type      IS NULL OR category ILIKE '%' || p_type || '%')
      AND (p_min_price IS NULL OR daily_rate >= p_min_price)
      AND (p_max_price IS NULL OR daily_rate <= p_max_price)
      AND (p_q IS NULL OR (
            name ILIKE '%' || p_q || '%' OR description ILIKE '%' || p_q || '%' OR
            village ILIKE '%' || p_q || '%' OR town ILIKE '%' || p_q || '%' OR
            district ILIKE '%' || p_q || '%'
      ))
      AND (p_lat IS NULL OR p_lng IS NULL OR location_point IS NULL OR
            ST_DWithin(location_point, ST_SetSRID(ST_Point(p_lng, p_lat), 4326)::geography, p_radius_km * 1000)
      )
    ORDER BY
        CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND location_point IS NOT NULL
            THEN ST_Distance(location_point, ST_SetSRID(ST_Point(p_lng, p_lat), 4326)::geography) ELSE 99999 END ASC,
        avg_rating DESC NULLS LAST,
        created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── 9. ROW LEVEL SECURITY (RLS) POLICIES ─────────────────────────────────────

ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment         ENABLE ROW LEVEL SECURITY;

-- Orders RLS: Visible only to buyer and farmer involved
CREATE POLICY orders_select ON orders FOR SELECT USING (
  buyer_id = auth.uid() OR farmer_id = auth.uid()
);

-- GPS RLS: Visible to renter, owner, and admin
CREATE POLICY gps_select ON gps_locations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM equipment_rentals r
    WHERE r.id = rental_id AND (r.renter_id = auth.uid() OR r.owner_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role_id = 4
  )
);

-- Payments RLS: Visible only to payer, payee, or admin
CREATE POLICY payments_select ON payments FOR SELECT USING (
  payer_id = auth.uid() OR payee_id = auth.uid() OR EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role_id = 4
  )
);

-- Equipment RLS: Anyone can read active/verified equipment, but only owner can modify
CREATE POLICY equipment_select ON equipment FOR SELECT USING (
  status = 'active' OR owner_id = auth.uid()
);
CREATE POLICY equipment_all ON equipment FOR ALL USING (
  owner_id = auth.uid()
) WITH CHECK (
  owner_id = auth.uid()
);

-- Equipment Rentals RLS: Visible to renter, owner, or admin
CREATE POLICY rentals_select ON equipment_rentals FOR SELECT USING (
  renter_id = auth.uid() OR owner_id = auth.uid() OR EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role_id = 4
  )
);
CREATE POLICY rentals_insert ON equipment_rentals FOR INSERT WITH CHECK (
  renter_id = auth.uid()
);
CREATE POLICY rentals_update ON equipment_rentals FOR UPDATE USING (
  renter_id = auth.uid() OR owner_id = auth.uid()
);

-- Users RLS: Users can read/update their own profile
CREATE POLICY users_select_own ON users FOR SELECT USING (
  id = auth.uid()
);
CREATE POLICY users_update_own ON users FOR UPDATE USING (
  id = auth.uid()
) WITH CHECK (
  id = auth.uid()
);
