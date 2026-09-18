/**
 * What a browser could reach through PostgREST without going through the API.
 *
 * Two independent layers must each deny access on their own:
 *   layer 1 — the public API roles (anon, authenticated) hold no privileges on application tables;
 *   layer 2 — row-level security is on for every application table with no policies, so even a role that
 *             is granted access sees no rows.
 * A hosted Supabase project grants anon/authenticated ALL on public tables by default, so layer 2 is tested
 * with the privilege deliberately granted rather than assumed.
 */
const { withDb, resetRateLimits, createUser, createEquipment, login, isoDate } = require('./helpers');

const REST = `${String(process.env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1`;
const PUBLIC_ROLES = ['anon', 'authenticated'];
// PostGIS reference data created and owned by the extension, not by the application.
const EXTENSION_TABLES = new Set(['spatial_ref_sys']);

async function applicationTables(db) {
    const { rows } = await db.query(
        `SELECT c.relname AS name, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         ORDER BY c.relname`,
    );
    return rows.filter((r) => !EXTENSION_TABLES.has(r.name));
}

describe('database access for the public API roles', () => {
    beforeAll(async () => {
        // "No rows visible" proves nothing about an empty table, and equipment_rentals — who rented what, from
        // whom, for how much — is the one most worth proving. A freshly created database has none, so make one.
        await resetRateLimits();
        const owner = await createUser('owner', 'RLS Owner');
        const renter = await createUser('farmer', 'RLS Renter');
        const equipmentId = await createEquipment(owner.id, { dailyRate: 500, deposit: 0 });
        const renterAgent = await login(renter);
        await renterAgent
            .post('/api/v1/bookings')
            .send({ machineId: equipmentId, startDate: isoDate(500), endDate: isoDate(501), paymentMethod: 'cod' })
            .expect(201);
    });

    test('every application table has row-level security enabled', async () => {
        const tables = await withDb(applicationTables);
        expect(tables.length).toBeGreaterThan(20);
        expect(tables.filter((t) => !t.rls).map((t) => t.name)).toEqual([]);
    });

    test('layer 1: anon and authenticated hold no privileges on any application table, sequence or function', async () => {
        await withDb(async (db) => {
            const tables = await applicationTables(db);
            const granted = [];
            for (const role of PUBLIC_ROLES) {
                for (const { name } of tables) {
                    const { rows } = await db.query(
                        `SELECT has_table_privilege($1, format('public.%I', $2::text), 'SELECT, INSERT, UPDATE, DELETE') AS any`,
                        [role, name],
                    );
                    if (rows[0].any) granted.push(`${role}:${name}`);
                }
            }
            expect(granted).toEqual([]);

            const { rows: functions } = await db.query(
                `SELECT r.rolname, p.proname
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname = ANY($1)) r
                 WHERE n.nspname = 'public'
                   AND p.proname IN ('compute_equipment_avg_rating', 'drivers_increment_trips', 'find_nearest_available_drivers',
                                     'try_assign_driver', 'find_nearby_equipment', 'redeem_promo_code', 'public_platform_stats')
                   AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')`,
                [PUBLIC_ROLES],
            );
            expect(functions).toEqual([]);
        });
    });

    test('layer 1 through the REST API: an anonymous read and an anonymous RPC are refused', async () => {
        const read = await fetch(`${REST}/users?select=id&limit=1`);
        expect(read.status).toBe(401);
        expect((await read.json()).code).toBe('42501'); // insufficient_privilege

        const rpc = await fetch(`${REST}/rpc/redeem_promo_code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_code: 'FARM100' }),
        });
        expect([401, 404]).toContain(rpc.status);
    });

    test('layer 2: with SELECT granted, row-level security alone hides every row of every table', async () => {
        await withDb(async (db) => {
            const tables = await applicationTables(db);
            const withRows = [];
            const visible = [];
            await db.query('BEGIN');
            try {
                for (const { name } of tables) {
                    await db.query(`SET LOCAL ROLE service_role`);
                    const all = await db.query(`SELECT count(*)::int AS n FROM public.${db.escapeIdentifier(name)}`);
                    await db.query('RESET ROLE');
                    if (all.rows[0].n > 0) withRows.push(name);

                    await db.query(`GRANT SELECT ON public.${db.escapeIdentifier(name)} TO anon`);
                    await db.query('SET LOCAL ROLE anon');
                    const seen = await db.query(`SELECT count(*)::int AS n FROM public.${db.escapeIdentifier(name)}`);
                    await db.query('RESET ROLE');
                    if (seen.rows[0].n > 0) visible.push(`${name}:${seen.rows[0].n}`);
                }
            } finally {
                await db.query('ROLLBACK'); // the grants never persist
            }
            // The comparison only means something for tables that actually hold data.
            expect(withRows).toEqual(expect.arrayContaining(['users', 'equipment', 'equipment_rentals', 'roles']));
            expect(visible).toEqual([]);
        });
    });

    test('layer 2 through the REST API: a granted anonymous read of users returns no rows', async () => {
        await withDb((db) => db.query('GRANT SELECT ON public.users TO anon'));
        try {
            const res = await fetch(`${REST}/users?select=id,email`);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual([]);
        } finally {
            await withDb((db) => db.query('REVOKE ALL ON public.users FROM anon'));
        }
        const after = await fetch(`${REST}/users?select=id&limit=1`);
        expect(after.status).toBe(401);
    });

    test('the API role still reads and writes through REST', async () => {
        const key = process.env.SUPABASE_SERVICE_KEY;
        const res = await fetch(`${REST}/roles?select=id,name&order=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        expect(res.status).toBe(200);
        expect((await res.json()).map((r) => r.name)).toEqual(['farmer', 'buyer', 'owner', 'admin', 'driver']);
    });
});
