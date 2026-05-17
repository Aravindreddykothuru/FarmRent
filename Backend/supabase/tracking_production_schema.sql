-- =============================================================================
-- tracking_production_schema.sql
-- Run in Supabase SQL Editor (Project → SQL Editor → New Query)
-- =============================================================================

-- ── 1. trip_locations — GPS breadcrumb history per booking ───────────────────
CREATE TABLE IF NOT EXISTS trip_locations (
    id          UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id  UUID            REFERENCES bookings(id)  ON DELETE CASCADE,
    driver_id   UUID            REFERENCES drivers(id)   ON DELETE CASCADE,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    heading     DOUBLE PRECISION DEFAULT 0,
    speed       DOUBLE PRECISION DEFAULT 0,
    accuracy    DOUBLE PRECISION DEFAULT 10,
    gps_flags   TEXT[]           DEFAULT '{}',
    created_at  TIMESTAMPTZ      DEFAULT NOW()
);

-- Spatial indexes for efficient trip replay and analytics queries
CREATE INDEX IF NOT EXISTS idx_trip_locations_booking
    ON trip_locations(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_locations_driver
    ON trip_locations(driver_id, created_at DESC);

-- ── 2. Add location_sharing flag to drivers ──────────────────────────────────
ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS location_sharing BOOLEAN DEFAULT true;

-- ── 3. Performance indexes (if not already present) ──────────────────────────

-- Partial index: only available drivers with coordinates (for nearest search)
CREATE INDEX IF NOT EXISTS idx_drivers_available_coords
    ON drivers(is_available)
    WHERE is_available = true;

-- Covering index for booking lookups by renter
CREATE INDEX IF NOT EXISTS idx_bookings_renter_status
    ON bookings(renter_id, status);

CREATE INDEX IF NOT EXISTS idx_bookings_driver_status
    ON bookings(driver_id, status);

CREATE INDEX IF NOT EXISTS idx_bookings_created_at
    ON bookings(created_at DESC);

-- ── 4. RPC: Haversine nearest-driver search (Redis fallback) ─────────────────
CREATE OR REPLACE FUNCTION find_nearest_available_drivers(
    p_lat       DOUBLE PRECISION,
    p_lng       DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 50,
    p_limit     INTEGER          DEFAULT 1
)
RETURNS TABLE (
    id           UUID,
    distance_km  DOUBLE PRECISION,
    current_lat  DOUBLE PRECISION,
    current_lng  DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        (6371 * acos(LEAST(1.0,
            cos(radians(p_lat)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(d.current_lat))
        ))) AS distance_km,
        d.current_lat,
        d.current_lng
    FROM drivers d
    WHERE d.is_available = true
      AND d.location_sharing IS NOT false
      AND d.current_lat IS NOT NULL
      AND d.current_lng IS NOT NULL
      AND (6371 * acos(LEAST(1.0,
            cos(radians(p_lat)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(d.current_lat))
          ))) <= p_radius_km
    ORDER BY distance_km ASC
    LIMIT p_limit;
END;
$$;

-- ── 5. RPC: Atomic trip counter increment ────────────────────────────────────
CREATE OR REPLACE FUNCTION drivers_increment_trips(driver_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE drivers
    SET total_trips = COALESCE(total_trips, 0) + 1
    WHERE id = driver_id;
END;
$$;

-- ── 6. RPC: Get trip path for replay ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_trip_path(p_booking_id UUID)
RETURNS TABLE (
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    heading     DOUBLE PRECISION,
    speed       DOUBLE PRECISION,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT latitude, longitude, heading, speed, created_at
    FROM   trip_locations
    WHERE  booking_id = p_booking_id
    ORDER  BY created_at ASC;
$$;

-- ── 7. RLS policies for trip_locations ───────────────────────────────────────
ALTER TABLE trip_locations ENABLE ROW LEVEL SECURITY;

-- Drivers can insert their own locations
DROP POLICY IF EXISTS trip_locations_driver_insert ON trip_locations;
CREATE POLICY trip_locations_driver_insert ON trip_locations
    FOR INSERT
    WITH CHECK (
        driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
    );

-- Renters can view locations for their bookings
DROP POLICY IF EXISTS trip_locations_renter_select ON trip_locations;
CREATE POLICY trip_locations_renter_select ON trip_locations
    FOR SELECT
    USING (
        booking_id IN (SELECT id FROM bookings WHERE renter_id = auth.uid())
        OR
        driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
    );
