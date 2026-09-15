-- =============================================================================
-- FarmRent — REQUIRED Supabase Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- This file combines two pending migrations into one idempotent script.
-- 
-- After running this:
--   1. Enable Realtime on equipment_locations:
--      Dashboard → Database → Replication → Add table: equipment_locations
--   2. The "[equipmentSchema] Extended columns missing" warning will disappear.
-- =============================================================================

-- ─── Part 1: Extended equipment columns ──────────────────────────────────────
ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS address_full      TEXT,
    ADD COLUMN IF NOT EXISTS village           TEXT,
    ADD COLUMN IF NOT EXISTS town              TEXT,
    ADD COLUMN IF NOT EXISTS district          TEXT,
    ADD COLUMN IF NOT EXISTS state             TEXT,
    ADD COLUMN IF NOT EXISTS pincode           VARCHAR(6),
    ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC DEFAULT 50,
    ADD COLUMN IF NOT EXISTS service_pincodes  TEXT[]  DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS avg_rating        NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rating_count      INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS price_weekly      NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS price_monthly     NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS is_deleted        BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_approved       BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS is_verified       BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS category          TEXT,
    ADD COLUMN IF NOT EXISTS pickup_lat        DECIMAL(10, 8),
    ADD COLUMN IF NOT EXISTS pickup_lng        DECIMAL(11, 8),
    ADD COLUMN IF NOT EXISTS pickup_address    TEXT,
    ADD COLUMN IF NOT EXISTS pickup_landmark   TEXT;

-- Migrate existing location text -> district (only if 'location' column exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'location'
    ) THEN
        EXECUTE 'UPDATE equipment SET district = location WHERE district IS NULL AND location IS NOT NULL AND location <> ''''';
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_equipment_pincode ON equipment(pincode) WHERE pincode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_district ON equipment(district) WHERE district IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_lat_lng ON equipment(latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- RPC: find_nearby_equipment
CREATE OR REPLACE FUNCTION find_nearby_equipment(
    p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_radius_km DOUBLE PRECISION DEFAULT 50
) RETURNS SETOF equipment LANGUAGE sql STABLE AS $$
    SELECT * FROM equipment
    WHERE is_approved = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND (6371 * acos(LEAST(1.0, cos(radians(p_lat)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(p_lng)) + sin(radians(p_lat)) * sin(radians(latitude))
      ))) <= p_radius_km
    ORDER BY (6371 * acos(LEAST(1.0, cos(radians(p_lat)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(p_lng)) + sin(radians(p_lat)) * sin(radians(latitude))
      ))) ASC LIMIT 100;
$$;

-- ─── Part 2: equipment_locations table for live GPS ──────────────────────────
CREATE TABLE IF NOT EXISTS equipment_locations (
    id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
    equipment_id  UUID         REFERENCES equipment(id) ON DELETE CASCADE,
    booking_id    UUID         REFERENCES equipment_rentals(id) ON DELETE CASCADE,
    lat           DECIMAL(10, 8) NOT NULL,
    lng           DECIMAL(11, 8) NOT NULL,
    accuracy      DECIMAL(10, 2),
    speed         DECIMAL(10, 2),
    heading       DECIMAL(10, 2),
    altitude      DECIMAL(10, 2),
    source        VARCHAR(20) DEFAULT 'mobile_gps',
    device_id     TEXT,
    battery_level INT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_locations_equipment_id ON equipment_locations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_locations_booking_id ON equipment_locations(booking_id);
CREATE INDEX IF NOT EXISTS idx_equipment_locations_updated_at ON equipment_locations(updated_at DESC);

-- RLS
ALTER TABLE equipment_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Farmer can view equipment location" ON equipment_locations;
CREATE POLICY "Farmer can view equipment location" ON equipment_locations
    FOR SELECT USING (auth.uid() IN (SELECT renter_id FROM equipment_rentals WHERE id = booking_id));

DROP POLICY IF EXISTS "Owner can insert location" ON equipment_locations;
CREATE POLICY "Owner can insert location" ON equipment_locations
    FOR INSERT WITH CHECK (auth.uid() IN (SELECT owner_id FROM equipment_rentals WHERE id = booking_id));

DROP POLICY IF EXISTS "Owner can view own locations" ON equipment_locations;
CREATE POLICY "Owner can view own locations" ON equipment_locations
    FOR SELECT USING (auth.uid() IN (SELECT owner_id FROM equipment_rentals WHERE id = booking_id));

-- Helper RPC
CREATE OR REPLACE FUNCTION get_latest_location(p_booking_id UUID)
RETURNS TABLE(lat DECIMAL, lng DECIMAL, accuracy DECIMAL, speed DECIMAL, heading DECIMAL, updated_at TIMESTAMPTZ) AS $$
    SELECT lat, lng, accuracy, speed, heading, updated_at
    FROM equipment_locations WHERE booking_id = p_booking_id ORDER BY updated_at DESC LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- NEXT STEP: Enable Realtime on equipment_locations in Supabase Dashboard
-- Dashboard -> Database -> Replication -> Add: equipment_locations
