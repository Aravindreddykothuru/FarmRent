/**
 * Shared equipment SELECT clause + schema-resilience helpers.
 * Falls back to BASE_SELECT automatically when the extended columns from
 * equipment_location_schema.sql haven't been applied to the database yet.
 */

const BASE_SELECT = `
    id, owner_id, name, type, description, price_per_day, location,
    latitude, longitude, images, status, horsepower, year, brand,
    is_approved, created_at, updated_at
`.trim();

const EXTENDED_SELECT = `${BASE_SELECT},
    address_full, village, town, district, state, pincode,
    service_radius_km, service_pincodes,
    avg_rating, rating_count`;

// Shared mutable state — downgraded to BASE_SELECT the first time a schema
// error is detected. Reset per process restart (fine for dev; prod runs
// with migrated DB so it stays at EXTENDED).
const state = { select: EXTENDED_SELECT };

function isSchemaMissing(err) {
    if (!err) return false;
    const msg = String(err.message || err.details || '').toLowerCase();
    return (
        msg.includes('schema cache') ||
        msg.includes('could not find the') ||
        msg.includes('column') ||
        String(err.code || '') === '42703' ||
        String(err.code || '') === 'pgrst205'
    );
}

function downgrade() {
    if (state.select !== BASE_SELECT) {
        console.warn(
            '[equipmentSchema] Extended columns missing — downgrading to base schema.\n' +
            '  Run Backend/supabase/equipment_location_schema.sql in your Supabase SQL Editor to unlock full features.'
        );
        state.select = BASE_SELECT;
    }
}

/**
 * Run a Supabase query; if it fails because of missing columns, downgrade
 * the shared SELECT and return null so the caller can retry.
 */
async function safeQuery(queryPromise) {
    const { data, error } = await queryPromise;
    if (error && isSchemaMissing(error) && state.select !== BASE_SELECT) {
        downgrade();
        return null; // caller retries with updated state.select
    }
    return { data, error };
}

/** Remove extended-schema fields from an insert/update object. */
function stripExtended(obj) {
    const ext = ['address_full', 'village', 'town', 'district', 'state',
                  'pincode', 'service_radius_km', 'service_pincodes'];
    const out = { ...obj };
    ext.forEach(k => delete out[k]);
    return out;
}

/** Current SELECT string — use this in every Supabase .select() call. */
function getSelect() { return state.select; }

module.exports = { getSelect, safeQuery, stripExtended, BASE_SELECT };
