const BASE_SELECT = `
    id, owner_id, name, category, description, daily_rate,
    latitude, longitude, images, status, year_of_mfg,
    is_verified, created_at
`.trim();

const EXTENDED_SELECT = `${BASE_SELECT},
    price_weekly, price_monthly, is_deleted,
    address_full, village, town, district, state, pincode,
    service_radius_km, service_pincodes,
    avg_rating, rating_count`.trim();

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
        console.warn('[equipmentSchema] Extended or optional columns missing — downgrading to base schema.');
        state.select = BASE_SELECT;
    }
}

async function safeQuery(queryOrFn) {
    const isFn = typeof queryOrFn === 'function';
    let result = await (isFn ? queryOrFn() : queryOrFn);

    if (result && result.error && isSchemaMissing(result.error) && state.select !== BASE_SELECT) {
        downgrade();
        if (isFn) {
            result = await queryOrFn();
        } else {
            return null; // Return null to trigger caller-side retry (e.g. result === null)
        }
    }
    return result;
}

function stripExtended(obj) {
    const ext = [
        'address_full',
        'village',
        'town',
        'district',
        'state',
        'pincode',
        'service_radius_km',
        'service_pincodes',
        'price_weekly',
        'price_monthly',
        'is_deleted',
    ];
    const out = { ...obj };
    ext.forEach((k) => delete out[k]);
    return out;
}

function getSelect() {
    return state.select;
}

module.exports = { getSelect, safeQuery, stripExtended, BASE_SELECT };
