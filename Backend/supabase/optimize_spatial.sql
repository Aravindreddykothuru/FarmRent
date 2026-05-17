-- SQL script to optimize driver search and general query performance
-- Run in Supabase SQL Editor

-- 1. Optimized Spatial Search Function (Haversine)
-- Returns nearest available drivers within a radius
CREATE OR REPLACE FUNCTION find_nearest_available_drivers(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_km DOUBLE PRECISION DEFAULT 50,
  p_limit INTEGER DEFAULT 1
)
RETURNS TABLE (
  id UUID,
  distance_km DOUBLE PRECISION,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id,
    (6371 * acos(
        cos(radians(p_lat)) * cos(radians(d.current_lat)) * 
        cos(radians(d.current_lng) - radians(p_lng)) + 
        sin(radians(p_lat)) * sin(radians(d.current_lat))
    )) AS distance_km,
    d.current_lat,
    d.current_lng
  FROM drivers d
  WHERE d.is_available = true
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
$$;

-- 2. Performance Indexes
-- Index for availability and location (for find_nearest)
CREATE INDEX IF NOT EXISTS idx_drivers_available_coords 
ON drivers(is_available) 
WHERE is_available = true;

-- Index for booking performance
CREATE INDEX IF NOT EXISTS idx_bookings_renter_status 
ON bookings(renter_id, status);

CREATE INDEX IF NOT EXISTS idx_bookings_created_at 
ON bookings(created_at DESC);
