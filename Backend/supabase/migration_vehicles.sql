-- ============================================================
-- FarmRent — Migration: Drivers, Vehicles & Booking Lifecycle
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Add 'driver' to the users role check
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('farmer', 'owner', 'admin', 'driver'));

-- 2. Drivers profile table
CREATE TABLE IF NOT EXISTS drivers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_name    TEXT NOT NULL,
  vehicle_type    TEXT NOT NULL DEFAULT 'Tractor',
  vehicle_number  TEXT NOT NULL,
  license_number  TEXT,
  is_available    BOOLEAN DEFAULT true,
  current_lat     DOUBLE PRECISION,
  current_lng     DOUBLE PRECISION,
  heading         DOUBLE PRECISION DEFAULT 0,
  speed           DOUBLE PRECISION DEFAULT 0,
  rating          NUMERIC(3,2) DEFAULT 5.00,
  total_trips     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Extend bookings with lifecycle & GPS columns
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_id    UUID REFERENCES drivers(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lat   DOUBLE PRECISION;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lng   DOUBLE PRECISION;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lat  DOUBLE PRECISION;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lng  DOUBLE PRECISION;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS distance_km  NUMERIC(8,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eta_minutes  INT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS route_geometry TEXT; -- GeoJSON LineString
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accepted_at  TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 4. Update bookings status check to include new lifecycle states
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('requested', 'pending', 'accepted', 'in_progress', 'completed', 'cancelled'));

-- 5. RLS for drivers table
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY drivers_public_read ON drivers FOR SELECT USING (is_available = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY drivers_all_read ON drivers FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY drivers_own_write ON drivers FOR ALL
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_drivers_available    ON drivers(is_available) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_drivers_user         ON drivers(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_driver      ON bookings(driver_id);
CREATE INDEX IF NOT EXISTS idx_drivers_coords       ON drivers(current_lat, current_lng) WHERE current_lat IS NOT NULL;

-- 7. Trigger for drivers updated_at
CREATE TRIGGER trg_drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 8. Seed demo drivers (linked to demo users from seed.sql)
-- First insert a driver user if not exists
INSERT INTO users (id, email, name, role, password_hash) VALUES
  ('44444444-0000-0000-0000-000000000001', 'driver1@demo.com', 'Raju Driver',   'driver', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('44444444-0000-0000-0000-000000000002', 'driver2@demo.com', 'Srinivas Driver','driver', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('44444444-0000-0000-0000-000000000003', 'driver3@demo.com', 'Venkat Driver', 'driver', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')
ON CONFLICT (email) DO NOTHING;

-- Then insert driver profiles
INSERT INTO drivers (id, user_id, vehicle_name, vehicle_type, vehicle_number, license_number, is_available, current_lat, current_lng, rating, total_trips)
VALUES
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001',
   'John Deere 5075E', 'Tractor', 'TS09AB1234', 'DL-TG-20180001', true, 17.4065, 78.4772, 4.80, 42),
  ('55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002',
   'Mahindra 575 DI',  'Tractor', 'TS10CD5678', 'DL-TG-20190002', true, 17.3616, 78.4747, 4.95, 67),
  ('55555555-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000003',
   'CLAAS Harvester',  'Harvester','TS07EF9012', 'DL-TG-20170003', false,17.3850, 78.4867, 4.70, 28)
ON CONFLICT (id) DO NOTHING;

-- 9. RPC Functions
-- Function to increment total_trips for a driver
CREATE OR REPLACE FUNCTION drivers_increment_trips(driver_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE drivers
  SET total_trips = total_trips + 1,
      updated_at = NOW()
  WHERE id = driver_id;
END;
$$ LANGUAGE plpgsql;

