-- ============================================================
-- GPS Tracking System — Phase 1 Migration
-- Run this in the Supabase SQL editor BEFORE deploying code.
-- ============================================================

-- 1. Add pickup location columns to equipment table
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS pickup_lat      DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS pickup_lng      DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS pickup_address  TEXT,
  ADD COLUMN IF NOT EXISTS pickup_landmark TEXT;

-- 2. Live GPS tracking table
CREATE TABLE IF NOT EXISTS equipment_locations (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  equipment_id UUID         REFERENCES equipment(id) ON DELETE CASCADE,
  booking_id   UUID         REFERENCES bookings(id)  ON DELETE CASCADE,
  lat          DECIMAL(10, 8) NOT NULL,
  lng          DECIMAL(11, 8) NOT NULL,
  accuracy     DECIMAL(10, 2),
  speed        DECIMAL(10, 2),   -- km/h
  heading      DECIMAL(10, 2),   -- degrees
  altitude     DECIMAL(10, 2),   -- metres
  source       VARCHAR(20) DEFAULT 'mobile_gps',  -- 'mobile_gps' | 'vehicle_gps'
  device_id    TEXT,
  battery_level INT,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_equipment_locations_equipment_id
  ON equipment_locations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_locations_booking_id
  ON equipment_locations(booking_id);
CREATE INDEX IF NOT EXISTS idx_equipment_locations_updated_at
  ON equipment_locations(updated_at DESC);

-- 4. Auto-cleanup: keep at most 500 location points per equipment
CREATE OR REPLACE FUNCTION cleanup_old_locations()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM equipment_locations
  WHERE equipment_id = NEW.equipment_id
    AND id NOT IN (
      SELECT id FROM equipment_locations
      WHERE equipment_id = NEW.equipment_id
      ORDER BY updated_at DESC
      LIMIT 500
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_cleanup_locations ON equipment_locations;
CREATE TRIGGER trigger_cleanup_locations
  AFTER INSERT ON equipment_locations
  FOR EACH ROW EXECUTE FUNCTION cleanup_old_locations();

-- 5. Row-Level Security
ALTER TABLE equipment_locations ENABLE ROW LEVEL SECURITY;

-- Renter (farmer) of the booking can read the location
DROP POLICY IF EXISTS "Farmer can view equipment location" ON equipment_locations;
CREATE POLICY "Farmer can view equipment location" ON equipment_locations
  FOR SELECT USING (
    auth.uid() IN (
      SELECT farmer_id FROM bookings WHERE id = booking_id
    )
  );

-- Equipment owner can insert locations
DROP POLICY IF EXISTS "Owner can insert location" ON equipment_locations;
CREATE POLICY "Owner can insert location" ON equipment_locations
  FOR INSERT WITH CHECK (
    auth.uid() IN (
      SELECT owner_id FROM bookings WHERE id = booking_id
    )
  );

-- Owner can also view their own inserts
DROP POLICY IF EXISTS "Owner can view own locations" ON equipment_locations;
CREATE POLICY "Owner can view own locations" ON equipment_locations
  FOR SELECT USING (
    auth.uid() IN (
      SELECT owner_id FROM bookings WHERE id = booking_id
    )
  );

-- 6. Helper RPC — get the latest location for a booking
CREATE OR REPLACE FUNCTION get_latest_location(p_booking_id UUID)
RETURNS TABLE(
  lat        DECIMAL,
  lng        DECIMAL,
  accuracy   DECIMAL,
  speed      DECIMAL,
  heading    DECIMAL,
  updated_at TIMESTAMPTZ
) AS $$
  SELECT lat, lng, accuracy, speed, heading, updated_at
  FROM equipment_locations
  WHERE booking_id = p_booking_id
  ORDER BY updated_at DESC
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- 7. Supabase Realtime publication — allow realtime on equipment_locations
-- (Run this if the table isn't already on the realtime publication)
-- ALTER PUBLICATION supabase_realtime ADD TABLE equipment_locations;
