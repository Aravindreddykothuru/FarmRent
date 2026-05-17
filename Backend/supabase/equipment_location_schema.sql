-- =============================================================================
-- equipment_location_schema.sql
-- Run in Supabase SQL Editor: Project → SQL Editor → New Query
-- =============================================================================

-- ── 1. Add structured address columns to equipment ───────────────────────────
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
    ADD COLUMN IF NOT EXISTS rating_count      INTEGER DEFAULT 0;

-- ── 2. Migrate existing location text into district column ───────────────────
UPDATE equipment
SET district = location
WHERE district IS NULL AND location IS NOT NULL AND location <> '';

-- ── 3. Indexes for geo/pincode/district search ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_equipment_pincode
    ON equipment(pincode)
    WHERE pincode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_district
    ON equipment(district)
    WHERE district IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_status_approved
    ON equipment(status, is_approved);

CREATE INDEX IF NOT EXISTS idx_equipment_lat_lng
    ON equipment(latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ── 4. RPC: Haversine radius search for equipment ────────────────────────────
CREATE OR REPLACE FUNCTION find_nearby_equipment(
    p_lat       DOUBLE PRECISION,
    p_lng       DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 50
)
RETURNS SETOF equipment
LANGUAGE sql
STABLE
AS $$
    SELECT *
    FROM equipment
    WHERE
        is_approved = true
        AND latitude  IS NOT NULL
        AND longitude IS NOT NULL
        AND (6371 * acos(LEAST(1.0,
            cos(radians(p_lat)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(latitude))
        ))) <= p_radius_km
    ORDER BY
        (6371 * acos(LEAST(1.0,
            cos(radians(p_lat)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(latitude))
        ))) ASC
    LIMIT 100;
$$;

-- ── 5. RPC: Text + geo combined search ───────────────────────────────────────
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
RETURNS SETOF equipment
LANGUAGE sql
STABLE
AS $$
    SELECT *
    FROM equipment
    WHERE is_approved = true
      AND status = 'available'
      AND (p_pincode   IS NULL OR pincode ILIKE p_pincode)
      AND (p_district  IS NULL OR district ILIKE '%' || p_district || '%')
      AND (p_type      IS NULL OR type ILIKE '%' || p_type || '%')
      AND (p_min_price IS NULL OR price_per_day >= p_min_price)
      AND (p_max_price IS NULL OR price_per_day <= p_max_price)
      AND (p_q IS NULL OR (
            name        ILIKE '%' || p_q || '%' OR
            description ILIKE '%' || p_q || '%' OR
            village     ILIKE '%' || p_q || '%' OR
            town        ILIKE '%' || p_q || '%' OR
            district    ILIKE '%' || p_q || '%'
      ))
      AND (
            p_lat IS NULL OR p_lng IS NULL OR
            latitude IS NULL OR longitude IS NULL OR
            (6371 * acos(LEAST(1.0,
                cos(radians(p_lat)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(p_lng)) +
                sin(radians(p_lat)) * sin(radians(latitude))
            ))) <= p_radius_km
      )
    ORDER BY
        CASE
            WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
            THEN (6371 * acos(LEAST(1.0,
                cos(radians(p_lat)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(p_lng)) +
                sin(radians(p_lat)) * sin(radians(latitude))
            )))
            ELSE 99999
        END ASC,
        avg_rating DESC NULLS LAST,
        created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
$$;

-- ── 6. Refresh equipment GEO index in Redis (run manually if needed) ─────────
-- This is handled automatically by the application layer when equipment is
-- added/updated via PATCH /api/v1/machines/:id.

-- ── 7. RLS: Allow read on equipment for everyone ─────────────────────────────
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_read_public ON equipment;
CREATE POLICY equipment_read_public ON equipment
    FOR SELECT
    USING (is_approved = true);

DROP POLICY IF EXISTS equipment_owner_write ON equipment;
CREATE POLICY equipment_owner_write ON equipment
    FOR ALL
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());
