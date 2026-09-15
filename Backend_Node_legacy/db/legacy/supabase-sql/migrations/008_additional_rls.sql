-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008: Row-Level Security for remaining database tables
-- Run this in Supabase SQL Editor (requires service role to execute)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enable RLS on remaining tables
ALTER TABLE drivers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats               ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_tracking   ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_locations      ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to allow clean re-run
DROP POLICY IF EXISTS "drivers_select_authenticated" ON drivers;
DROP POLICY IF EXISTS "drivers_write_own" ON drivers;
DROP POLICY IF EXISTS "chats_select_parties" ON chats;
DROP POLICY IF EXISTS "chats_insert_parties" ON chats;
DROP POLICY IF EXISTS "equipment_tracking_select_parties" ON equipment_tracking;
DROP POLICY IF EXISTS "equipment_tracking_insert_owner" ON equipment_tracking;
DROP POLICY IF EXISTS "offers_select_parties" ON offers;
DROP POLICY IF EXISTS "offers_insert_renter" ON offers;
DROP POLICY IF EXISTS "offers_update_parties" ON offers;
DROP POLICY IF EXISTS "saved_searches_all_own" ON saved_searches;
DROP POLICY IF EXISTS "promo_codes_select_all" ON promo_codes;
DROP POLICY IF EXISTS "equipment_locations_select_parties" ON equipment_locations;
DROP POLICY IF EXISTS "equipment_locations_insert_owner" ON equipment_locations;
DROP POLICY IF EXISTS "trip_locations_select_parties" ON trip_locations;
DROP POLICY IF EXISTS "trip_locations_insert_driver" ON trip_locations;

-- ─────────────────────────────────────────────────────────────────────────────
-- DRIVERS
-- ─────────────────────────────────────────────────────────────────────────────
-- Authenticated users can read driver profiles
CREATE POLICY "drivers_select_authenticated" ON drivers
  FOR SELECT USING (auth.role() = 'authenticated');

-- Drivers can update/manage only their own profile row
CREATE POLICY "drivers_write_own" ON drivers
  FOR ALL USING (user_id::text = auth.uid()::text) WITH CHECK (user_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- CHATS
-- ─────────────────────────────────────────────────────────────────────────────
-- Only booking farmer (renter) or owner can read and write chats
CREATE POLICY "chats_select_parties" ON chats
  FOR SELECT USING (farmer_id::text = auth.uid()::text OR owner_id::text = auth.uid()::text);

CREATE POLICY "chats_insert_parties" ON chats
  FOR INSERT WITH CHECK (farmer_id::text = auth.uid()::text OR owner_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- EQUIPMENT TRACKING / HISTORY
-- ─────────────────────────────────────────────────────────────────────────────
-- Booking parties can read GPS history
CREATE POLICY "equipment_tracking_select_parties" ON equipment_tracking
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.equipment_id = equipment_tracking.equipment_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text)
    )
  );

-- Only owner can insert tracking points
CREATE POLICY "equipment_tracking_insert_owner" ON equipment_tracking
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM equipment e
      WHERE e.id = equipment_tracking.equipment_id
        AND e.owner_id::text = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- OFFERS (Negotiations)
-- ─────────────────────────────────────────────────────────────────────────────
-- Only renting farmer or equipment owner can read/write offers
CREATE POLICY "offers_select_parties" ON offers
  FOR SELECT USING (renter_id::text = auth.uid()::text OR owner_id::text = auth.uid()::text);

CREATE POLICY "offers_insert_renter" ON offers
  FOR INSERT WITH CHECK (renter_id::text = auth.uid()::text);

CREATE POLICY "offers_update_parties" ON offers
  FOR UPDATE USING (renter_id::text = auth.uid()::text OR owner_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- SAVED SEARCHES
-- ─────────────────────────────────────────────────────────────────────────────
-- Users can only manage their own saved searches
CREATE POLICY "saved_searches_all_own" ON saved_searches
  FOR ALL USING (user_id::text = auth.uid()::text) WITH CHECK (user_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- PROMO CODES
-- ─────────────────────────────────────────────────────────────────────────────
-- Authenticated users can view active promo codes
CREATE POLICY "promo_codes_select_all" ON promo_codes
  FOR SELECT USING (auth.role() = 'authenticated' AND is_active = true);

-- ─────────────────────────────────────────────────────────────────────────────
-- EQUIPMENT LOCATIONS (Realtime tracking table)
-- ─────────────────────────────────────────────────────────────────────────────
-- Booking parties can read location updates
CREATE POLICY "equipment_locations_select_parties" ON equipment_locations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = equipment_locations.booking_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text)
    )
  );

-- Renter or owner can write locations (renter for mobile tracking, owner for device/browser tracking)
CREATE POLICY "equipment_locations_insert_owner" ON equipment_locations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = equipment_locations.booking_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIP LOCATIONS (Driver trip trace history)
-- ─────────────────────────────────────────────────────────────────────────────
-- Renter, owner, or assigned driver can read trip traces
CREATE POLICY "trip_locations_select_parties" ON trip_locations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = trip_locations.booking_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text OR b.driver_id::text = auth.uid()::text)
    )
  );

-- Renter or driver can insert coordinates (since renter is the passenger/recipient)
CREATE POLICY "trip_locations_insert_driver" ON trip_locations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = trip_locations.booking_id
        AND (b.driver_id::text = auth.uid()::text OR b.renter_id::text = auth.uid()::text)
    )
  );
