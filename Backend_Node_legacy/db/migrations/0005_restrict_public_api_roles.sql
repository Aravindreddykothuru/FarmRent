-- Defense in depth for the PostgREST roles a browser can use (anon, authenticated).
--
-- Layer 2 — row-level security — is enabled on every application table and has no policies, so those roles
-- see no rows even when they hold privileges. A Supabase project grants them ALL on new public tables by
-- default, which would leave RLS as the only barrier. Layer 1 removes those privileges, so an RLS mistake
-- alone cannot expose data. The API uses service_role (BYPASSRLS) and is unaffected.

-- ── Layer 1: no table, sequence or application-function privileges for the public API roles ─────────────
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Application functions only: PostGIS also lives in this schema and its functions stay as the extension set them.
DO $$
DECLARE
    fn regprocedure;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('set_updated_at', 'equipment_sync_location_point', 'compute_equipment_avg_rating',
                            'drivers_increment_trips', 'find_nearest_available_drivers', 'try_assign_driver',
                            'find_nearby_equipment', 'redeem_promo_code', 'public_platform_stats')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END
$$;

-- ── Layer 2: row-level security on every table the application owns ─────────────────────────────────────
-- schema_migrations is created by the migration runner before 0001 runs, so the baseline did not cover it.
ALTER TABLE IF EXISTS schema_migrations ENABLE ROW LEVEL SECURITY;
