-- A rental's GPS trail with plain coordinates.
--
-- gps_locations.location is a geography; PostgREST serialises it as hex EWKB, which the API could not turn
-- back into coordinates, so GET /api/v1/tracking/booking/:id/history returned every point with
-- latitude/longitude null. PostGIS extracts them here instead.

CREATE OR REPLACE FUNCTION rental_location_history(p_rental_id UUID, p_limit INTEGER DEFAULT 5000)
RETURNS TABLE (
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    heading     DOUBLE PRECISION,
    speed_kmh   DOUBLE PRECISION,
    accuracy    DOUBLE PRECISION,
    altitude    DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT ST_Y(g.location::geometry), ST_X(g.location::geometry), g.heading, g.speed_kmh, g.accuracy, g.altitude, g.recorded_at
    FROM gps_locations g
    WHERE g.rental_id = p_rental_id
      AND g.location IS NOT NULL
    ORDER BY g.recorded_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
$$;

-- Only the API's service role may call it; access checks happen in the API before it is used.
REVOKE ALL ON FUNCTION rental_location_history(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rental_location_history(UUID, INTEGER) TO service_role;
