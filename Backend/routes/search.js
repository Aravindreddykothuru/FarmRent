/**
 * Backend/routes/search.js — Production-grade geospatial equipment search
 *
 * Endpoints:
 *   GET /api/v1/search/machines   — Smart search: PIN → nearby → radius → text
 *   GET /api/v1/search/geocode    — Reverse geocode (lat,lng → address)
 *   GET /api/v1/search/places     — Autocomplete place name search
 *   GET /api/v1/search/pincode    — Lookup PIN code → lat/lng/district
 *   GET /api/v1/search/nearby     — Equipment within radius of a lat/lng
 *
 * Smart matching priority:
 *   1. Same PIN code as farmer
 *   2. Same district
 *   3. Equipment whose service_radius_km covers farmer's location
 *   4. Haversine radius-based fallback (50km default)
 *   5. Full-text / type filter fallback
 *
 * Sort modes: distance | rating | price_asc | price_desc
 */

const express   = require('express');
const router    = express.Router();
const supabase  = require('../lib/supabase');
const { redisClient } = require('../services/tracking-service/redisClient');
const { reverseGeocode, searchPlaces, lookupPincode } = require('../lib/geocoder');
const { getSelect, safeQuery } = require('../lib/equipmentSchema');

// ── Haversine ─────────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Shape: Supabase row → enriched Machine ────────────────────────────────────

function toMachine(row, farmerLat, farmerLng) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    const distKm = Number.isFinite(lat) && Number.isFinite(lng) && farmerLat && farmerLng
        ? haversineKm(farmerLat, farmerLng, lat, lng)
        : null;

    return {
        id:          row.id,
        _id:         row.id,
        name:        row.name,
        type:        row.type?.toLowerCase().replace(/\s+/g, '-') || 'tractor',
        description: row.description || '',
        status:      row.status || 'available',
        owner:       row.owner_id,
        brand:       row.brand || '',
        images:      row.images || [],
        pricing: {
            baseRatePerDay:  Number(row.price_per_day) || 0,
            baseRatePerHour: Math.round((Number(row.price_per_day) || 0) / 8),
        },
        location: {
            full:     row.address_full     || row.location || '',
            village:  row.village          || '',
            town:     row.town             || '',
            district: row.district         || row.location || '',
            state:    row.state            || '',
            pincode:  row.pincode          || '',
            coordinates: Number.isFinite(lat) && Number.isFinite(lng)
                ? { type: 'Point', coordinates: [lng, lat] }
                : undefined,
        },
        service_radius_km:  row.service_radius_km  || 50,
        service_pincodes:   row.service_pincodes   || [],
        distance_km:         distKm,
        ratings:     { average: Number(row.avg_rating) || 0, count: Number(row.rating_count) || 0 },
        createdAt:   row.created_at,
        latitude:    lat,
        longitude:   lng,
    };
}

// getSelect() is now dynamic — use getSelect() from equipmentSchema.js

// ── Smart sort ────────────────────────────────────────────────────────────────

function sortMachines(machines, sort) {
    return [...machines].sort((a, b) => {
        switch (sort) {
            case 'rating':
                return (b.ratings?.average || 0) - (a.ratings?.average || 0);
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

// ─── GET /api/v1/search/machines ─────────────────────────────────────────────
router.get('/machines', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const {
        q, type, status = 'available',
        lat, lng, radius = '50',
        pincode, district,
        sort = 'distance',
        limit = '40', offset = '0',
        minPrice, maxPrice,
    } = req.query;

    const farmerLat = Number(lat);
    const farmerLng = Number(lng);
    const hasGeo    = Number.isFinite(farmerLat) && Number.isFinite(farmerLng);
    const radiusKm  = parseFloat(radius) || 50;

    try {
        // ── Phase 1: PIN code match (exact) ──────────────────────────────────
        let pincodeResults = [];
        if (pincode && /^\d{6}$/.test(String(pincode).trim())) {
            const cleanPin = String(pincode).trim();
            let pq = supabase
                .from('equipment')
                .select(getSelect())
                .eq('is_approved', true)
                .eq('status', status)
                .eq('pincode', cleanPin);
            if (type)     pq = pq.ilike('type', `%${type.replace(/-/g, ' ')}%`);
            if (q)        pq = pq.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
            if (minPrice) pq = pq.gte('price_per_day', Number(minPrice));
            if (maxPrice) pq = pq.lte('price_per_day', Number(maxPrice));
            const res1 = await safeQuery(pq.limit(40)) || await safeQuery(pq.limit(40));
            pincodeResults = ((res1?.data) || []).map(r => toMachine(r, farmerLat, farmerLng));
        }

        // ── Phase 2: District match ───────────────────────────────────────────
        let districtResults = [];
        const searchDistrict = district || (
            pincode && pincodeResults.length === 0
                ? (await lookupPincode(pincode))?.district
                : null
        );
        if (searchDistrict) {
            let dq = supabase
                .from('equipment')
                .select(getSelect())
                .eq('is_approved', true)
                .eq('status', status)
                .ilike('district', `%${searchDistrict}%`);
            if (type)     dq = dq.ilike('type', `%${type.replace(/-/g, ' ')}%`);
            if (q)        dq = dq.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
            if (minPrice) dq = dq.gte('price_per_day', Number(minPrice));
            if (maxPrice) dq = dq.lte('price_per_day', Number(maxPrice));
            const res2 = await safeQuery(dq.limit(40)) || await safeQuery(dq.limit(40));
            districtResults = ((res2?.data) || []).map(r => toMachine(r, farmerLat, farmerLng));
        }

        // ── Phase 3: Redis GEO radius search ──────────────────────────────────
        let nearbyIds = new Set();
        if (hasGeo && redisClient?.isReady) {
            try {
                const geoResults = await redisClient.sendCommand([
                    'GEOSEARCH', 'machines:geo',
                    'FROMMEMBER', // not useful, use FROMLONLAT
                    'FROMLONLAT', String(farmerLng), String(farmerLat),
                    'BYRADIUS', String(radiusKm), 'km',
                    'ASC', 'COUNT', '100',
                ]).catch(() => null);
                if (Array.isArray(geoResults)) {
                    geoResults.forEach(id => nearbyIds.add(id));
                }
            } catch {
                // Redis GEOSEARCH may not be available on older versions — fallback to DB
            }
        }

        // ── Phase 4: DB Haversine for equipment within service_radius_km ──────
        let haversineResults = [];
        if (hasGeo) {
            // Use Supabase RPC for DB-level radius search (fallback when Redis unavailable)
            const { data: rpcData } = await supabase
                .rpc('find_nearby_equipment', {
                    p_lat:       farmerLat,
                    p_lng:       farmerLng,
                    p_radius_km: radiusKm,
                })
                .then(r => r, () => ({ data: null }));

            if (Array.isArray(rpcData)) {
                // Filter by type/query/price on top of geo results
                haversineResults = rpcData
                    .filter(r => {
                        if (status && r.status !== status) return false;
                        if (type && !r.type?.includes(type.replace(/-/g, ' '))) return false;
                        if (q) {
                            const qs = q.toLowerCase();
                            if (!r.name?.toLowerCase().includes(qs) && !r.description?.toLowerCase().includes(qs)) return false;
                        }
                        if (minPrice && Number(r.price_per_day) < Number(minPrice)) return false;
                        if (maxPrice && Number(r.price_per_day) > Number(maxPrice)) return false;
                        return true;
                    })
                    .map(r => toMachine(r, farmerLat, farmerLng));
            }
        }

        // ── Phase 5: Text / type fallback (no geo) ────────────────────────────
        let textResults = [];
        if (!hasGeo && !pincode) {
            let tq = supabase
                .from('equipment')
                .select(getSelect())
                .eq('is_approved', true)
                .eq('status', status);
            if (type)     tq = tq.ilike('type', `%${type.replace(/-/g, ' ')}%`);
            if (q)        tq = tq.or(`name.ilike.%${q}%,description.ilike.%${q}%,location.ilike.%${q}%,village.ilike.%${q}%,district.ilike.%${q}%`);
            if (minPrice) tq = tq.gte('price_per_day', Number(minPrice));
            if (maxPrice) tq = tq.lte('price_per_day', Number(maxPrice));
            tq = tq.order('created_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
            const res5 = await safeQuery(tq) || await safeQuery(tq);
            textResults = ((res5?.data) || []).map(r => toMachine(r, null, null));
        }

        // ── Merge & deduplicate (PIN first, then district, then geo) ──────────
        const seen = new Set();
        const merged = [];
        const addUnique = (list) => {
            list.forEach(m => {
                if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
            });
        };
        addUnique(pincodeResults);
        addUnique(districtResults);
        addUnique(haversineResults);
        addUnique(textResults);

        // ── Sort ──────────────────────────────────────────────────────────────
        const sorted = sortMachines(merged, sort);

        // ── Slice for pagination ──────────────────────────────────────────────
        const page = sorted.slice(Number(offset), Number(offset) + Number(limit));

        return res.json({
            machines:   page,
            total:      merged.length,
            sources: {
                pincode:  pincodeResults.length,
                district: districtResults.length,
                geo:      haversineResults.length,
                text:     textResults.length,
            },
        });

    } catch (error) {
        console.error('[search/machines] error:', error.message);
        return res.status(500).json({ error: 'Search failed', msg: error.message });
    }
});

// ─── GET /api/v1/search/geocode?lat=&lng= ────────────────────────────────────
// Reverse geocode a lat/lng to full structured address
router.get('/geocode', async (req, res) => {
    const { lat, lng } = req.query;
    const latitude  = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
        return res.status(400).json({ error: 'lat and lng required' });

    try {
        const address = await reverseGeocode(latitude, longitude);
        return res.json({ success: true, data: address });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─── GET /api/v1/search/places?q= ────────────────────────────────────────────
// Autocomplete search for Indian place names / villages / towns
router.get('/places', async (req, res) => {
    const { q, limit = '8' } = req.query;
    if (!q || String(q).trim().length < 2)
        return res.status(400).json({ error: 'q must be at least 2 characters' });

    try {
        const places = await searchPlaces(String(q).trim(), Number(limit));
        return res.json({ success: true, data: places });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─── GET /api/v1/search/pincode?code= ────────────────────────────────────────
// Lookup an Indian PIN code → centre lat/lng + district + state
router.get('/pincode', async (req, res) => {
    const { code } = req.query;
    if (!code || !/^\d{6}$/.test(String(code).trim()))
        return res.status(400).json({ error: 'code must be a 6-digit Indian PIN code' });

    try {
        const result = await lookupPincode(String(code).trim());
        if (!result) return res.status(404).json({ error: 'PIN code not found' });
        return res.json({ success: true, data: result });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─── GET /api/v1/search/nearby?lat=&lng=&radius=&type= ───────────────────────
// Quick GEO search — lightweight wrapper for machine map markers
router.get('/nearby', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { lat, lng, radius = '50', type, limit = '30' } = req.query;
    const latitude  = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
        return res.status(400).json({ error: 'lat and lng required' });

    const { data } = await supabase
        .rpc('find_nearby_equipment', {
            p_lat:       latitude,
            p_lng:       longitude,
            p_radius_km: parseFloat(radius) || 50,
        })
        .then(r => r, () => ({ data: [] }));

    let machines = (data || []).map(r => toMachine(r, latitude, longitude));
    if (type) machines = machines.filter(m => m.type.includes(type.replace(/-/g, ' ')));
    machines = sortMachines(machines, 'distance').slice(0, Number(limit));

    return res.json({ success: true, machines });
});

module.exports = router;
