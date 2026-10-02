/**
 * search-service/routes.js — geospatial equipment search
 *
 * Endpoints:
 *   GET /api/v1/search/machines   — Smart search: PIN → district → radius → text
 *   GET /api/v1/search/geocode    — Reverse geocode (lat,lng → address)
 *   GET /api/v1/search/places     — Autocomplete place name search
 *   GET /api/v1/search/pincode    — Lookup PIN code → lat/lng/district
 *   GET /api/v1/search/nearby     — Equipment within radius of a lat/lng
 *
 * Sort modes: distance | rating | popularity | price_asc | price_desc
 */

const express = require('express');
const router = express.Router();
const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');
const { HttpError } = require('../../lib/httpError');
const { asyncHandler } = require('../../middleware/asyncHandler');
const { searchLimiter } = require('../../middleware/redisRateLimiter');
const { suggestMachines } = require('../../lib/elasticsearch');
const { reverseGeocode, searchPlaces, lookupPincode } = require('../../lib/geocoder');

const SEARCH_SELECT = [
    'id',
    'owner_id',
    'name',
    'category',
    'description',
    'brand',
    'daily_rate',
    'price_weekly',
    'price_monthly',
    'latitude',
    'longitude',
    'images',
    'status',
    'is_deleted',
    'address_full',
    'village',
    'town',
    'district',
    'state',
    'pincode',
    'service_radius_km',
    'service_pincodes',
    'avg_rating',
    'rating_count',
    'created_at',
].join(', ');
const PHASE_LIMIT = 40;

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

// Free text is placed inside PostgREST filter expressions, whose syntax uses , ( ) . and quotes.
const searchTerm = (value) =>
    String(value || '')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Shape: equipment row → enriched Machine ──────────────────────────────────
function toMachine(row, farmerLat, farmerLng) {
    const lat = row.latitude == null ? null : Number(row.latitude);
    const lng = row.longitude == null ? null : Number(row.longitude);
    const hasOrigin = Number.isFinite(farmerLat) && Number.isFinite(farmerLng);
    const distKm = lat != null && lng != null && hasOrigin ? haversineKm(farmerLat, farmerLng, lat, lng) : null;
    const baseRatePerDay = Number(row.daily_rate) || 0;

    return {
        id: row.id,
        _id: row.id,
        name: row.name,
        type: row.category,
        description: row.description || '',
        status: row.status === 'active' ? 'available' : row.status,
        owner: row.owner_id,
        brand: row.brand || '',
        images: row.images || [],
        pricing: {
            baseRatePerDay,
            baseRatePerHour: Math.round(baseRatePerDay / 8),
            weeklyRate: row.price_weekly == null ? null : Number(row.price_weekly),
            monthlyRate: row.price_monthly == null ? null : Number(row.price_monthly),
        },
        location: {
            full: row.address_full || '',
            village: row.village || '',
            town: row.town || '',
            district: row.district || '',
            state: row.state || '',
            pincode: row.pincode || '',
            coordinates: lat != null && lng != null ? { type: 'Point', coordinates: [lng, lat] } : undefined,
        },
        service_radius_km: Number(row.service_radius_km) || 50,
        service_pincodes: row.service_pincodes || [],
        distance_km: distKm == null ? null : Math.round(distKm * 10) / 10,
        ratings: { average: Number(row.avg_rating) || 0, count: Number(row.rating_count) || 0 },
        createdAt: row.created_at,
        latitude: lat,
        longitude: lng,
    };
}

function sortMachines(machines, sort) {
    return [...machines].sort((a, b) => {
        switch (sort) {
            case 'rating':
                return (b.ratings?.average || 0) - (a.ratings?.average || 0);
            case 'popularity':
                return (b.ratings?.count || 0) - (a.ratings?.count || 0);
            case 'price_asc':
                return (a.pricing?.baseRatePerDay || 0) - (b.pricing?.baseRatePerDay || 0);
            case 'price_desc':
                return (b.pricing?.baseRatePerDay || 0) - (a.pricing?.baseRatePerDay || 0);
            case 'distance':
            default:
                if (a.distance_km == null && b.distance_km == null) return 0;
                if (a.distance_km == null) return 1;
                if (b.distance_km == null) return -1;
                return a.distance_km - b.distance_km;
        }
    });
}

/** Base query for rentable listings with the shared type / text / price filters applied. */
function listingQuery({ type, q, minPrice, maxPrice }) {
    let query = db().from('equipment').select(SEARCH_SELECT).eq('is_verified', true).eq('is_deleted', false).eq('status', 'active');
    const typeTerm = searchTerm(type).replace(/ /g, '-');
    if (typeTerm) query = query.ilike('category', `%${typeTerm}%`);
    const text = searchTerm(q);
    if (text) {
        query = query.or(
            ['name', 'description', 'brand', 'village', 'town', 'district'].map((column) => `${column}.ilike.*${text}*`).join(','),
        );
    }
    if (Number.isFinite(minPrice)) query = query.gte('daily_rate', minPrice);
    if (Number.isFinite(maxPrice)) query = query.lte('daily_rate', maxPrice);
    return query;
}

// ─── GET /api/v1/search/machines ─────────────────────────────────────────────
router.get(
    '/machines',
    searchLimiter,
    asyncHandler(async (req, res) => {
        const { q, type, pincode, district, sort = 'distance' } = req.query;
        const farmerLat = Number.parseFloat(req.query.lat);
        const farmerLng = Number.parseFloat(req.query.lng);
        const hasGeo = Number.isFinite(farmerLat) && Number.isFinite(farmerLng);
        const radiusKm = Math.min(Number.parseFloat(req.query.radius) || 50, 500);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 100);
        const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
        const filters = {
            type,
            q,
            minPrice: req.query.minPrice === undefined ? NaN : Number(req.query.minPrice),
            maxPrice: req.query.maxPrice === undefined ? NaN : Number(req.query.maxPrice),
        };
        const cleanPin = String(pincode || '').trim();

        // Phase 1: exact PIN code
        let pincodeResults = [];
        if (/^\d{6}$/.test(cleanPin)) {
            const { data, error } = await listingQuery(filters).eq('pincode', cleanPin).limit(PHASE_LIMIT);
            if (error) throw error;
            pincodeResults = (data || []).map((r) => toMachine(r, farmerLat, farmerLng));
        }

        // Phase 2: district (given, or derived from an unmatched PIN)
        let districtResults = [];
        let searchDistrict = searchTerm(district);
        if (!searchDistrict && cleanPin && pincodeResults.length === 0) {
            try {
                searchDistrict = searchTerm((await lookupPincode(cleanPin))?.district);
            } catch (err) {
                logger.warn('[search] PIN lookup failed; skipping district phase', { pincode: cleanPin, error: err.message });
            }
        }
        if (searchDistrict) {
            const { data, error } = await listingQuery(filters).ilike('district', `%${searchDistrict}%`).limit(PHASE_LIMIT);
            if (error) throw error;
            districtResults = (data || []).map((r) => toMachine(r, farmerLat, farmerLng));
        }

        // Phase 3: radius around the farmer
        let nearbyResults = [];
        if (hasGeo) {
            const { data, error } = await db().rpc('find_nearby_equipment', { p_lat: farmerLat, p_lng: farmerLng, p_radius_km: radiusKm });
            if (error) throw error;
            const typeTerm = searchTerm(type).replace(/ /g, '-').toLowerCase();
            const text = searchTerm(q).toLowerCase();
            nearbyResults = (data || [])
                .filter((r) => !typeTerm || r.category?.toLowerCase().includes(typeTerm))
                .filter((r) => !text || [r.name, r.description, r.brand, r.district].some((v) => v?.toLowerCase().includes(text)))
                .filter((r) => !Number.isFinite(filters.minPrice) || Number(r.daily_rate) >= filters.minPrice)
                .filter((r) => !Number.isFinite(filters.maxPrice) || Number(r.daily_rate) <= filters.maxPrice)
                .map((r) => toMachine(r, farmerLat, farmerLng));
        }

        // Phase 4: text / type browse when there is no location context
        let textResults = [];
        if (!hasGeo && !cleanPin && !searchDistrict) {
            const { data, error } = await listingQuery(filters)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (error) throw error;
            textResults = (data || []).map((r) => toMachine(r, null, null));
        }

        const seen = new Set();
        const merged = [];
        for (const machine of [...pincodeResults, ...districtResults, ...nearbyResults, ...textResults]) {
            if (!seen.has(machine.id)) {
                seen.add(machine.id);
                merged.push(machine);
            }
        }

        const sorted = sortMachines(merged, sort);
        // Phase 4 is already paginated in SQL; the location phases are merged, then paginated here.
        const page = textResults.length && merged.length === textResults.length ? sorted : sorted.slice(offset, offset + limit);

        return res.json({
            machines: page,
            total: merged.length,
            sources: {
                pincode: pincodeResults.length,
                district: districtResults.length,
                geo: nearbyResults.length,
                text: textResults.length,
            },
        });
    }),
);

// ─── GET /api/v1/search/geocode?lat=&lng= ────────────────────────────────────
router.get(
    '/geocode',
    asyncHandler(async (req, res) => {
        const latitude = Number.parseFloat(req.query.lat);
        const longitude = Number.parseFloat(req.query.lng);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'lat and lng required');
        }
        const address = await reverseGeocode(latitude, longitude);
        return res.json({ success: true, data: address });
    }),
);

// ─── GET /api/v1/search/places?q= ────────────────────────────────────────────
router.get(
    '/places',
    asyncHandler(async (req, res) => {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) throw new HttpError(400, 'VALIDATION_ERROR', 'q must be at least 2 characters');
        const limit = Math.min(Number(req.query.limit) || 8, 20);
        const places = await searchPlaces(q, limit);
        return res.json({ success: true, data: places });
    }),
);

// ─── GET /api/v1/search/pincode?code= ────────────────────────────────────────
router.get(
    '/pincode',
    asyncHandler(async (req, res) => {
        const code = String(req.query.code || '').trim();
        if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'VALIDATION_ERROR', 'code must be a 6-digit Indian PIN code');
        const result = await lookupPincode(code);
        if (!result) throw new HttpError(404, 'PINCODE_NOT_FOUND', 'PIN code not found');
        return res.json({ success: true, data: result });
    }),
);

// ─── GET /api/v1/search/nearby?lat=&lng=&radius=&type= ───────────────────────
router.get(
    '/nearby',
    asyncHandler(async (req, res) => {
        const latitude = Number.parseFloat(req.query.lat);
        const longitude = Number.parseFloat(req.query.lng);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'lat and lng required');
        }
        const radius = Math.min(Number.parseFloat(req.query.radius) || 50, 500);
        const limit = Math.min(Number.parseInt(req.query.limit, 10) || 30, 100);

        const { data, error } = await db().rpc('find_nearby_equipment', { p_lat: latitude, p_lng: longitude, p_radius_km: radius });
        if (error) throw error;

        const typeTerm = searchTerm(req.query.type).replace(/ /g, '-').toLowerCase();
        const machines = sortMachines(
            (data || []).map((r) => toMachine(r, latitude, longitude)).filter((m) => !typeTerm || m.type?.includes(typeTerm)),
            'distance',
        ).slice(0, limit);

        return res.json({ success: true, machines });
    }),
);

// ─── GET /api/v1/search/autocomplete ─────────────────────────────────────────
router.get(
    '/autocomplete',
    asyncHandler(async (req, res) => {
        const q = String(req.query.q || '').trim();
        if (!q) return res.json({ suggestions: [] });
        const suggestions = await suggestMachines(q);
        return res.json({ suggestions });
    }),
);

module.exports = router;
