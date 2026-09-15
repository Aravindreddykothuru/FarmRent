-- Platform totals for the public landing page (GET /api/v1/stats).
-- Returns aggregate counts only: no rows and no personal data leave the database.

CREATE OR REPLACE FUNCTION public_platform_stats() RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'machines', (SELECT count(*) FROM equipment
                      WHERE coalesce(is_deleted, false) = false AND status = 'active'),
        'renters',  (SELECT count(DISTINCT user_id) FROM user_roles WHERE role_id IN (1, 2)),
        'bookings', (SELECT count(*) FROM equipment_rentals WHERE status = 'completed'),
        'states',   (SELECT count(DISTINCT lower(btrim(state))) FROM equipment
                      WHERE coalesce(is_deleted, false) = false AND status = 'active'
                        AND coalesce(btrim(state), '') <> '')
    );
$$;

-- Only the API's service role may call it; the anonymous PostgREST role must not.
REVOKE ALL ON FUNCTION public_platform_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_platform_stats() TO service_role;
