/**
 * Backend/lib/geocoder.js — Server-side geocoding via Nominatim (OpenStreetMap)
 *
 * Features:
 *  • Reverse geocode: (lat, lng) → structured address { village, district, state, pincode, full }
 *  • Forward geocode: query string → [{ lat, lng, label, address }]
 *  • PIN code lookup: pincode → { lat, lng, district, state }
 *  • In-memory LRU cache (max 500 entries, 1h TTL) to minimize Nominatim calls
 *  • User-Agent set per Nominatim usage policy
 *  • 5s timeout with AbortController
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'FarmRent/1.0 (farm equipment rental platform)';
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour
const CACHE_MAX     = 500;

// ── Simple LRU cache ──────────────────────────────────────────────────────────

const cacheMap = new Map();

function cacheGet(key) {
    const entry = cacheMap.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) { cacheMap.delete(key); return null; }
    // LRU: re-insert to move to end
    cacheMap.delete(key);
    cacheMap.set(key, entry);
    return entry.value;
}

function cacheSet(key, value) {
    if (cacheMap.size >= CACHE_MAX) {
        // Evict oldest
        cacheMap.delete(cacheMap.keys().next().value);
    }
    cacheMap.set(key, { value, ts: Date.now() });
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function nominatimFetch(path, params = {}) {
    const url = new URL(path, NOMINATIM_BASE);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url.toString(), {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
        signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return res.json();
}

// ── Structured address extractor ─────────────────────────────────────────────

function extractAddress(data) {
    const addr = data?.address || {};
    return {
        full:     data?.display_name || '',
        village:  addr.village || addr.hamlet || addr.suburb || addr.neighbourhood || addr.locality || '',
        town:     addr.town || addr.city || addr.municipality || '',
        district: addr.county || addr.district || addr.state_district || '',
        state:    addr.state || '',
        country:  addr.country || 'India',
        pincode:  addr.postcode || '',
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reverse geocode: (lat, lng) → structured address
 * @returns {{ full, village, town, district, state, country, pincode }}
 */
async function reverseGeocode(lat, lng) {
    const key = `rev:${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    try {
        const data = await nominatimFetch('/reverse', { lat, lon: lng });
        const result = extractAddress(data);
        cacheSet(key, result);
        return result;
    } catch (e) {
        console.warn('[geocoder] reverseGeocode error:', e.message);
        return {
            full: `${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}`,
            village: '', town: '', district: '', state: '', country: 'India', pincode: '',
        };
    }
}

/**
 * Forward geocode: query string → array of results
 * @returns {Array<{ lat, lng, label, village, district, state, pincode }>}
 */
async function searchPlaces(query, limit = 8) {
    const key = `fwd:${query.trim().toLowerCase().slice(0, 60)}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    try {
        const data = await nominatimFetch('/search', { q: query, limit, countrycodes: 'in' });
        if (!Array.isArray(data)) return [];
        const results = data.map(r => ({
            lat:      Number(r.lat),
            lng:      Number(r.lon),
            label:    r.display_name || '',
            ...extractAddress(r),
        })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
        cacheSet(key, results);
        return results;
    } catch (e) {
        console.warn('[geocoder] searchPlaces error:', e.message);
        return [];
    }
}

/**
 * Lookup Indian PIN code → { lat, lng, district, state, pincode }
 * Uses Nominatim search with "postalcode=XXXXXX countrycodes=in"
 * @returns {{ lat, lng, district, state, pincode } | null}
 */
async function lookupPincode(pincode) {
    const clean = String(pincode).replace(/\D/g, '').slice(0, 6);
    if (clean.length !== 6) return null;

    const key = `pin:${clean}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    try {
        const data = await nominatimFetch('/search', { postalcode: clean, countrycodes: 'in', limit: 1 });
        if (!Array.isArray(data) || !data[0]) return null;
        const r = data[0];
        const addr = extractAddress(r);
        const result = {
            lat:      Number(r.lat),
            lng:      Number(r.lon),
            ...addr,
            pincode:  addr.pincode || clean,
        };
        cacheSet(key, result);
        return result;
    } catch (e) {
        console.warn('[geocoder] lookupPincode error:', e.message);
        return null;
    }
}

module.exports = { reverseGeocode, searchPlaces, lookupPincode };
