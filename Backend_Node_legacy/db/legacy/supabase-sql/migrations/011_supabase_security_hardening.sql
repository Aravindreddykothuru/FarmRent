-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: Supabase Security Hardening & Vulnerability Fixes
-- Run this in the Supabase SQL Editor to patch identified security risks.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. FIX CRITICAL USER DATA EXPOSURE ──────────────────────────────────────
-- Drop old insecure open SELECT policy on users table
DROP POLICY IF EXISTS "users_select_public" ON users;
DROP POLICY IF EXISTS "users_select_own" ON users;

-- Policy 1a: Users can read their own full profile (including email/phone)
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid()::text = id::text);

-- Create a secure public view excluding password_hash, email, phone
CREATE OR REPLACE VIEW public_profiles AS
SELECT 
    id, 
    name, 
    role, 
    avatar_url, 
    created_at
FROM users;

-- Grant public select on public_profiles view
GRANT SELECT ON public_profiles TO anon, authenticated;

-- ── 2. FIX HARDENED SECURITY DEFINER RPC FUNCTIONS ─────────────────────────
-- Re-create get_latest_location with caller authorization check
CREATE OR REPLACE FUNCTION get_latest_location(p_booking_id UUID)
RETURNS TABLE(
  lat        DECIMAL,
  lng        DECIMAL,
  accuracy   DECIMAL,
  speed      DECIMAL,
  heading    DECIMAL,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_caller_id TEXT := auth.uid()::text;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- Check if caller is renter, owner, or driver for this booking
  -- Supports both equipment_rentals and legacy bookings table
  SELECT EXISTS (
    SELECT 1 FROM equipment_rentals er
    WHERE er.id = p_booking_id
      AND (
        er.renter_id::text = v_caller_id OR 
        er.owner_id::text  = v_caller_id OR 
        er.driver_id::text = v_caller_id
      )
    UNION
    SELECT 1 FROM bookings b
    WHERE b.id = p_booking_id
      AND (
        b.renter_id::text = v_caller_id OR 
        b.owner_id::text  = v_caller_id
      )
  ) INTO v_is_authorized;

  -- Bypassed if service role key is used (v_caller_id IS NULL when using service role in Postgres)
  IF NOT v_is_authorized AND v_caller_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unauthorized: You are not a participant in this booking';
  END IF;

  RETURN QUERY
  SELECT el.lat, el.lng, el.accuracy, el.speed, el.heading, el.updated_at
  FROM equipment_locations el
  WHERE el.booking_id = p_booking_id
  ORDER BY el.updated_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 3. FIX BROKEN COLUMN REFERENCES & RLS ON EQUIPMENT_LOCATIONS ────────────
ALTER TABLE equipment_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Farmer can view equipment location" ON equipment_locations;
DROP POLICY IF EXISTS "locations_select_booking_parties" ON equipment_locations;

CREATE POLICY "locations_select_booking_parties" ON equipment_locations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM equipment_rentals er
      WHERE er.id = equipment_locations.booking_id
        AND (
          er.renter_id::text = auth.uid()::text OR 
          er.owner_id::text  = auth.uid()::text OR
          er.driver_id::text = auth.uid()::text
        )
      UNION
      SELECT 1 FROM bookings b
      WHERE b.id = equipment_locations.booking_id
        AND (
          b.renter_id::text = auth.uid()::text OR 
          b.owner_id::text  = auth.uid()::text
        )
    )
  );

-- ── 4. RLS POLICIES FOR CANONICAL TABLE: EQUIPMENT_RENTALS ──────────────────
ALTER TABLE equipment_rentals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_rentals_select_parties" ON equipment_rentals;
DROP POLICY IF EXISTS "equipment_rentals_insert_renter" ON equipment_rentals;
DROP POLICY IF EXISTS "equipment_rentals_update_parties" ON equipment_rentals;

CREATE POLICY "equipment_rentals_select_parties" ON equipment_rentals
  FOR SELECT USING (
    renter_id::text = auth.uid()::text OR
    owner_id::text  = auth.uid()::text OR
    driver_id::text = auth.uid()::text
  );

CREATE POLICY "equipment_rentals_insert_renter" ON equipment_rentals
  FOR INSERT WITH CHECK (renter_id::text = auth.uid()::text);

CREATE POLICY "equipment_rentals_update_parties" ON equipment_rentals
  FOR UPDATE USING (
    renter_id::text = auth.uid()::text OR
    owner_id::text  = auth.uid()::text OR
    driver_id::text = auth.uid()::text
  );
