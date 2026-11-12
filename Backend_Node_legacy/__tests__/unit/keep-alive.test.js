/**
 * The keep-alive job books and cancels a rental between two automatic accounts twice a day, so that a week
 * without visitors does not get the database paused (which is how the site was lost in October 2026).
 *
 * What matters is what it must never do: show up on the site, be counted, block a date, or book more than
 * twice a day however often the process restarts. The database here is an in-memory stand-in that understands
 * just the queries the job makes.
 */
const { runKeepAlive, startKeepAlive, OWNER_EMAIL, RENTER_EMAIL, LISTING_NAME } = require('../../lib/keepAlive');

function fakeDb({ failOn } = {}) {
    const tables = { users: [], equipment: [], equipment_rentals: [] };
    let nextId = 1;

    const from = (table) => {
        const q = { table, filters: [], action: 'select', payload: null, orderBy: null };
        const rows = () => tables[table].filter((r) => q.filters.every((f) => f(r)));
        const result = () => {
            if (failOn && failOn(q)) return { data: null, error: { message: 'boom' } };
            if (q.action === 'insert') {
                const row = { id: `id-${nextId++}`, created_at: q.now || new Date().toISOString(), ...q.payload };
                tables[table].push(row);
                return { data: row, error: null };
            }
            if (q.action === 'update') {
                rows().forEach((r) => Object.assign(r, q.payload));
                return { data: null, error: null };
            }
            if (q.action === 'delete') {
                const gone = new Set(rows());
                tables[table] = tables[table].filter((r) => !gone.has(r));
                return { data: null, error: null };
            }
            let found = rows();
            if (q.orderBy) found = [...found].sort((a, b) => (a[q.orderBy] < b[q.orderBy] ? 1 : -1));
            return { data: found[0] || null, error: null };
        };
        const api = {
            select: () => api,
            insert: (payload) => ((q.action = 'insert'), (q.payload = payload), api),
            update: (payload) => ((q.action = 'update'), (q.payload = payload), api),
            delete: () => ((q.action = 'delete'), api),
            eq: (col, val) => (q.filters.push((r) => r[col] === val), api),
            lt: (col, val) => (q.filters.push((r) => r[col] < val), api),
            order: (col) => ((q.orderBy = col), api),
            limit: () => api,
            maybeSingle: async () => result(),
            single: async () => result(),
            then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
        };
        return api;
    };
    return { from, tables: () => tables };
}

const NOON = new Date('2026-11-12T12:00:00.000Z');
const hoursLater = (h) => new Date(NOON.getTime() + h * 3600 * 1000);

describe('keep-alive bookings', () => {
    test('the first run creates the accounts, the listing and one cancelled booking', async () => {
        const db = fakeDb();
        const result = await runKeepAlive(db, NOON);

        expect(result.booked).toBe(true);
        const { users, equipment, equipment_rentals: rentals } = db.tables();
        expect(users.map((u) => u.email).sort()).toEqual([OWNER_EMAIL, RENTER_EMAIL].sort());
        expect(equipment).toHaveLength(1);
        expect(rentals).toHaveLength(1);
        expect(rentals[0].status).toBe('cancelled');
        expect(rentals[0].cancelled_at).toBe(NOON.toISOString());
    });

    test('nobody can sign in as the automatic accounts', async () => {
        const db = fakeDb();
        await runKeepAlive(db, NOON);
        // The login route only compares a password against a bcrypt hash; anything else is refused outright.
        for (const user of db.tables().users) expect(user.password_hash).not.toMatch(/^\$2[aby]\$/);
    });

    test('the listing is invisible: inactive, unverified, unavailable, and labelled for what it is', async () => {
        const db = fakeDb();
        await runKeepAlive(db, NOON);
        const [listing] = db.tables().equipment;

        // status = active and is_verified are what the site lists, the API lets people book, and the landing
        // page counts; inactive is also what keeps it out of the admin approval queue.
        expect(listing).toMatchObject({ status: 'inactive', is_verified: false, is_available: false, name: LISTING_NAME });
        expect(listing.daily_rate).toBeGreaterThan(0);
    });

    test('the booking never stays in a state that blocks dates or counts as a rental', async () => {
        const db = fakeDb();
        await runKeepAlive(db, NOON);
        const live = ['requested', 'approved', 'active', 'return_pending', 'completed'];
        expect(db.tables().equipment_rentals.filter((r) => live.includes(r.status))).toHaveLength(0);
    });

    test('restarting the process does not book again: a second run within 11 hours does nothing', async () => {
        const db = fakeDb();
        await runKeepAlive(db, NOON);
        db.tables().equipment_rentals[0].created_at = NOON.toISOString();

        const again = await runKeepAlive(db, hoursLater(3));

        expect(again).toEqual({ booked: false, reason: 'booked recently' });
        expect(db.tables().equipment_rentals).toHaveLength(1);
        expect(db.tables().users).toHaveLength(2);
        expect(db.tables().equipment).toHaveLength(1);
    });

    test('twelve hours later it books again, reusing the same accounts and listing', async () => {
        const db = fakeDb();
        await runKeepAlive(db, NOON);
        db.tables().equipment_rentals[0].created_at = NOON.toISOString();

        const second = await runKeepAlive(db, hoursLater(12));

        expect(second.booked).toBe(true);
        expect(db.tables().equipment_rentals).toHaveLength(2);
        expect(db.tables().users).toHaveLength(2);
        expect(db.tables().equipment).toHaveLength(1);
    });

    test('bookings older than a week are removed, so the table does not grow', async () => {
        const db = fakeDb();
        await runKeepAlive(db, NOON);
        db.tables().equipment_rentals[0].created_at = new Date(NOON.getTime() - 9 * 24 * 3600 * 1000).toISOString();

        await runKeepAlive(db, NOON);

        const rentals = db.tables().equipment_rentals;
        expect(rentals).toHaveLength(1);
        expect(new Date(rentals[0].created_at).getTime()).toBeGreaterThan(NOON.getTime() - 24 * 3600 * 1000);
    });

    test('a database error is reported with the step it happened at', async () => {
        const db = fakeDb({ failOn: (q) => q.table === 'equipment_rentals' && q.action === 'insert' });
        await expect(runKeepAlive(db, NOON)).rejects.toThrow('create booking: boom');
    });

    test('it runs in production only, and can be switched off', () => {
        const db = fakeDb();
        expect(startKeepAlive(db, { env: { NODE_ENV: 'development' } })).toBe(false);
        expect(startKeepAlive(db, { env: { NODE_ENV: 'test' } })).toBe(false);
        expect(startKeepAlive(db, { env: { NODE_ENV: 'production', KEEPALIVE_BOOKINGS: 'off' } })).toBe(false);
        expect(startKeepAlive(null, { env: { NODE_ENV: 'production' } })).toBe(false);
    });
});
