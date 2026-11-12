/**
 * Twice a day, books and cancels a rental between two automatic accounts.
 *
 * Supabase pauses a free project that receives no requests for a week, and a paused project takes the whole
 * site down with it: that is how the site was lost for three weeks in October 2026. On a quiet marketplace
 * "no requests for a week" is an ordinary week, so the application makes its own activity instead of waiting
 * for a visitor to supply it.
 *
 * It is built so that nothing a person sees changes:
 *   - the two accounts hold a password hash no password matches, so nobody can sign in as them;
 *   - the listing is inactive and unverified — never shown on the site, never bookable through the API, not in
 *     the admin approval queue, and not counted in the landing-page totals;
 *   - the booking is cancelled in the same run, and only completed rentals are counted anywhere;
 *   - no email or notification is sent: these are plain rows, not calls through the booking routes.
 * Everything is named "keep-alive (automatic)" so that it explains itself to an administrator who meets it.
 *
 * The check on the last booking makes a run idempotent across restarts and deploys: starting the process ten
 * times in a day still books twice.
 */
const logger = require('./logger');

const OWNER_EMAIL = 'keepalive-owner@farmrent.invalid';
const RENTER_EMAIL = 'keepalive-renter@farmrent.invalid';
const LISTING_NAME = 'Keep-alive test listing (automatic, not for rent)';
// Not a bcrypt hash, so the login route never compares a password against it.
const NO_LOGIN = '!keep-alive-account-cannot-sign-in';

const HOUR_MS = 60 * 60 * 1000;
const RUN_EVERY_MS = 12 * HOUR_MS;
// A little under the interval, so a timer that fires a few seconds early still books.
const MIN_GAP_MS = 11 * HOUR_MS;
const KEEP_HISTORY_DAYS = 7;
const BOOK_DAYS_AHEAD = 30;

const fail = (step, error) => Object.assign(new Error(`${step}: ${error.message}`), { step });

async function ensureUser(db, email, fullName) {
    const found = await db.from('users').select('id').eq('email', email).maybeSingle();
    if (found.error) throw fail(`find ${email}`, found.error);
    if (found.data) return found.data.id;

    const created = await db
        .from('users')
        .insert({ email, full_name: fullName, password_hash: NO_LOGIN, status: 'active' })
        .select('id')
        .single();
    if (created.error) throw fail(`create ${email}`, created.error);
    return created.data.id;
}

async function ensureListing(db, ownerId) {
    const found = await db.from('equipment').select('id').eq('owner_id', ownerId).eq('name', LISTING_NAME).maybeSingle();
    if (found.error) throw fail('find listing', found.error);
    if (found.data) return found.data.id;

    const created = await db
        .from('equipment')
        .insert({
            owner_id: ownerId,
            name: LISTING_NAME,
            description: 'Used by the application to keep its database active. Not a real machine.',
            category: 'other',
            daily_rate: 1,
            status: 'inactive',
            is_verified: false,
            is_available: false,
        })
        .select('id')
        .single();
    if (created.error) throw fail('create listing', created.error);
    return created.data.id;
}

const isoDate = (date) => date.toISOString().split('T')[0];

/**
 * One run. Returns { booked: true, bookingId } or { booked: false, reason }.
 * Throws when the database refuses a step; the caller logs it.
 */
async function runKeepAlive(db, now = new Date()) {
    const ownerId = await ensureUser(db, OWNER_EMAIL, 'FarmRent keep-alive owner (automatic)');
    const renterId = await ensureUser(db, RENTER_EMAIL, 'FarmRent keep-alive renter (automatic)');
    const listingId = await ensureListing(db, ownerId);

    const last = await db
        .from('equipment_rentals')
        .select('created_at')
        .eq('equipment_id', listingId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (last.error) throw fail('read last booking', last.error);
    if (last.data && now.getTime() - new Date(last.data.created_at).getTime() < MIN_GAP_MS) {
        return { booked: false, reason: 'booked recently' };
    }

    const day = isoDate(new Date(now.getTime() + BOOK_DAYS_AHEAD * 24 * HOUR_MS));
    const requested = await db
        .from('equipment_rentals')
        .insert({
            equipment_id: listingId,
            renter_id: renterId,
            owner_id: ownerId,
            status: 'requested',
            start_date: day,
            end_date: day,
            daily_rate: 1,
            total_amount: 1,
            payment_method: 'cod',
            notes: 'Automatic keep-alive booking. Not a real rental.',
        })
        .select('id')
        .single();
    if (requested.error) throw fail('create booking', requested.error);

    const cancelled = await db
        .from('equipment_rentals')
        .update({ status: 'cancelled', cancelled_at: now.toISOString(), cancellation_reason: 'Automatic keep-alive booking' })
        .eq('id', requested.data.id);
    if (cancelled.error) throw fail('cancel booking', cancelled.error);

    // The history has no value past showing that the job runs; without this the table grows by 730 rows a year.
    const cutoff = new Date(now.getTime() - KEEP_HISTORY_DAYS * 24 * HOUR_MS).toISOString();
    const pruned = await db
        .from('equipment_rentals')
        .delete()
        .eq('equipment_id', listingId)
        .eq('status', 'cancelled')
        .lt('created_at', cutoff);
    if (pruned.error) logger.warn('[keep-alive] could not prune old keep-alive bookings', { error: pruned.error.message });

    return { booked: true, bookingId: requested.data.id };
}

let timer = null;

/** Starts the twice-daily run. Production only, and only once per process. */
function startKeepAlive(db, { env = process.env } = {}) {
    if (timer || !db) return false;
    if (env.NODE_ENV !== 'production' || env.KEEPALIVE_BOOKINGS === 'off') return false;

    const tick = () =>
        runKeepAlive(db)
            .then((result) => logger.info('[keep-alive] run finished', result))
            .catch((err) => logger.error('[keep-alive] run failed', { error: err.message }));

    // Shortly after start rather than at it: the first minute of a deploy is when the database is busiest.
    setTimeout(tick, 60 * 1000).unref();
    timer = setInterval(tick, RUN_EVERY_MS);
    timer.unref();
    return true;
}

module.exports = { runKeepAlive, startKeepAlive, OWNER_EMAIL, RENTER_EMAIL, LISTING_NAME };
