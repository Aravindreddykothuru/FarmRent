/**
 * Backend/routes/machines.js — Production equipment CRUD
 *
 * Upgrades over v1:
 *  • Saves full structured address (village, town, district, state, pincode)
 *  • Reverse-geocodes lat/lng to fill address fields automatically on create/update
 *  • Updates Redis `machines:geo` GEOADD on location change
 *  • Returns enriched location with all address parts
 *  • Supports service_radius_km and service_pincodes fields for owners
 */

const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { redisClient } = require('../services/tracking-service/redisClient');
const { auth } = require('../middleware/auth');
const { reverseGeocode } = require('../lib/geocoder');

const { getSelect, safeQuery, stripExtended } = require('../lib/equipmentSchema');

const MACHINES_GEO_KEY = 'machines:geo';

// ── Shape converter: Supabase row → frontend Machine ─────────────────────────
const toMachine = (row) => ({
    id:          row.id,
    _id:         row.id,
    name:        row.name,
    type:        row.type?.toLowerCase().replace(/\s+/g, '-') || 'tractor',
    description: row.description || '',
    status:      row.status || 'available',
    owner:       row.owner_id || 'me',
    brand:       row.brand || '',
    images:      row.images || [],
    features:    [],
    specifications: { power: row.horsepower ? `${row.horsepower} HP` : undefined, year: row.year },
    pricing: {
        baseRatePerDay:  Number(row.price_per_day) || 0,
        baseRatePerHour: Math.round((Number(row.price_per_day) || 0) / 8),
        securityDeposit: 0,
        operatorIncluded: false,
    },
    location: {
        full:     row.address_full || row.location || '',
        village:  row.village  || '',
        town:     row.town     || '',
        district: row.district || row.location || '',
        state:    row.state    || '',
        pincode:  row.pincode  || '',
        coordinates: Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
            ? { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] }
            : undefined,
    },
    service_radius_km: row.service_radius_km || 50,
    service_pincodes:  row.service_pincodes  || [],
    ratings:       { average: Number(row.avg_rating) || 0, count: Number(row.rating_count) || 0 },
    latitude:      Number(row.latitude)  || null,
    longitude:     Number(row.longitude) || null,
    totalBookings: 0,
    createdAt:     row.created_at || new Date().toISOString(),
});

// ── Helper: index machine in Redis GEO ───────────────────────────────────────
async function indexMachineGeo(id, lat, lng) {
    if (!redisClient?.isReady || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    await redisClient.geoAdd(MACHINES_GEO_KEY, {
        longitude: lng, latitude: lat, member: String(id),
    }).catch(() => {});
}

// ── Shared query builder (re-usable with any select string) ─────────────────
function buildListQuery(selectStr, { status, type, q, owner, uid, limit, offset }) {
    let query = supabase.from('equipment').select(selectStr);
    if (status) query = query.eq('status', status);
    if (type)   query = query.ilike('type', `%${type.replace(/-/g, ' ')}%`);
    if (q)      query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,location.ilike.%${q}%`);
    if (owner === 'me' && uid) query = query.eq('owner_id', uid);
    else query = query.eq('is_approved', true);
    return query.order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
}

// ─── GET /api/v1/machines ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const { status, type, q, owner, limit = 50, offset = 0 } = req.query;
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    const uid = req.user?.id || req.user?.sub;
    if (owner === 'me' && !uid) return res.status(401).json({ error: 'Unauthorized' });

    const params = { status, type, q, owner, uid, limit, offset };

    let result = await safeQuery(buildListQuery(getSelect(), params));
    if (result === null) {
        // Downgraded to BASE_SELECT — retry
        result = await safeQuery(buildListQuery(getSelect(), params));
    }
    const { data, error } = result || {};
    if (error) return res.status(400).json({ error: error.message || 'Failed to load machines' });
    return res.json({ data: (data || []).map(toMachine) });
});

// ─── GET /api/v1/machines/nearby ─────────────────────────────────────────────
router.get('/nearby', async (req, res) => {
    const { lat, lng, radius = '50', type } = req.query;
    const latitude  = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
        return res.status(400).json({ error: 'lat and lng are required' });

    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    // Try Redis GEOSEARCH first
    if (redisClient?.isReady) {
        try {
            const geoIds = await redisClient.sendCommand([
                'GEOSEARCH', MACHINES_GEO_KEY,
                'FROMLONLAT', String(longitude), String(latitude),
                'BYRADIUS', String(parseFloat(radius) || 50), 'km',
                'ASC', 'COUNT', '80',
            ]).catch(() => null);

            if (Array.isArray(geoIds) && geoIds.length > 0) {
                const { data } = await supabase.from('equipment')
                    .select(getSelect())
                    .in('id', geoIds)
                    .eq('status', 'available')
                    .eq('is_approved', true);
                let machines = (data || []).map(r => toMachine(r));
                if (type) machines = machines.filter(m => m.type.includes(type.replace(/-/g, ' ')));
                return res.json({ data: machines, source: 'redis' });
            }
        } catch (err) {
            console.warn('[machines/nearby] Redis error:', err.message);
        }
    }

    // DB Haversine fallback
    const { data } = await supabase.rpc('find_nearby_equipment', {
        p_lat: latitude, p_lng: longitude, p_radius_km: parseFloat(radius) || 50,
    }).then(r => r, () => ({ data: [] }));
    let machines = (data || []).map(r => toMachine(r));
    if (type) machines = machines.filter(m => m.type.includes(type.replace(/-/g, ' ')));
    return res.json({ data: machines, source: 'db' });
});

// ─── GET /api/v1/machines/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    let result = await safeQuery(
        supabase.from('equipment').select(getSelect()).eq('id', req.params.id).single()
    );
    if (result === null) {
        result = await safeQuery(
            supabase.from('equipment').select(getSelect()).eq('id', req.params.id).single()
        );
    }
    const { data, error } = result || {};
    if (error || !data) return res.status(404).json({ error: 'Machine not found' });
    return res.json({ data: toMachine(data) });
});

// ─── POST /api/v1/machines ────────────────────────────────────────────────────
router.post('/', auth(true), async (req, res) => {
    const { name, pricing, location, type, description, images, _specifications, status: st,
            service_radius_km, service_pincodes } = req.body || {};
    if (!name || !pricing?.baseRatePerDay)
        return res.status(400).json({ error: 'name and pricing.baseRatePerDay are required' });

    const ownerId = req.user?.id || req.user?.sub || null;
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const lat = location?.coordinates?.coordinates?.[1];
    const lng = location?.coordinates?.coordinates?.[0];

    // Auto-reverse-geocode to fill structured address fields
    let geoAddr = {};
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        geoAddr = await reverseGeocode(Number(lat), Number(lng)).catch(() => ({}));
    }

    const row = {
        name,
        type:        type || 'tractor',
        description: description || '',
        price_per_day: pricing.baseRatePerDay,
        // Legacy string location field — use district
        location:    location?.district || location?.village || geoAddr.district || '',
        latitude:    Number.isFinite(Number(lat))  ? Number(lat)  : null,
        longitude:   Number.isFinite(Number(lng))  ? Number(lng)  : null,
        images:      images || [],
        status:      st || 'available',
        owner_id:    ownerId,
        is_approved: true,
        // Structured address
        address_full: location?.full    || geoAddr.full    || '',
        village:      location?.village || geoAddr.village || '',
        town:         location?.town    || geoAddr.town    || '',
        district:     location?.district || geoAddr.district || '',
        state:        location?.state   || geoAddr.state   || '',
        pincode:      location?.pincode || geoAddr.pincode || '',
        // Service area
        service_radius_km: service_radius_km || 50,
        service_pincodes:  service_pincodes  || [],
    };

    let insertResult = await safeQuery(
        supabase.from('equipment').insert(row).select(getSelect()).single()
    );
    if (insertResult === null) {
        // Retry with base fields only
        insertResult = await safeQuery(
            supabase.from('equipment').insert(stripExtended(row)).select(getSelect()).single()
        );
    }
    const { data, error } = insertResult || {};
    if (error) return res.status(400).json({ error: error.message || 'Failed to create equipment' });

    // Index in Redis
    if (Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
        await indexMachineGeo(data.id, data.latitude, data.longitude);
    }

    return res.status(201).json({ data: toMachine(data) });
});

// ─── PATCH /api/v1/machines/:id ──────────────────────────────────────────────
router.patch('/:id', auth(true), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const uid = req.user?.id || req.user?.sub;
    const { data: existing, error: readErr } = await supabase
        .from('equipment').select('id, owner_id').eq('id', req.params.id).single();
    if (readErr || !existing) return res.status(404).json({ error: 'Machine not found' });
    if (existing.owner_id && uid && String(existing.owner_id) !== String(uid))
        return res.status(403).json({ error: 'Forbidden' });

    const body   = req.body || {};
    const update = {};

    if (body.name)        update.name        = body.name;
    if (body.type)        update.type        = body.type;
    if (body.description) update.description = body.description;
    if (body.status)      update.status      = body.status;
    if (body.images)      update.images      = body.images;
    if (body.pricing?.baseRatePerDay) update.price_per_day = body.pricing.baseRatePerDay;

    // Service area controls
    if (body.service_radius_km != null) update.service_radius_km = Number(body.service_radius_km);
    if (body.service_pincodes)          update.service_pincodes  = body.service_pincodes;

    // Location update
    if (body.location) {
        const loc = body.location;
        if (loc.full)     update.address_full = loc.full;
        if (loc.village)  update.village      = loc.village;
        if (loc.town)     update.town         = loc.town;
        if (loc.district) { update.district = loc.district; update.location = loc.district; }
        if (loc.state)    update.state        = loc.state;
        if (loc.pincode)  update.pincode      = loc.pincode;

        if (Array.isArray(loc.coordinates?.coordinates)) {
            const [lng, lat] = loc.coordinates.coordinates;
            const lat_ = Number(lat), lng_ = Number(lng);
            if (Number.isFinite(lat_) && Number.isFinite(lng_)) {
                update.latitude  = lat_;
                update.longitude = lng_;

                // Auto-reverse-geocode if no explicit address provided
                if (!loc.village && !loc.district) {
                    const geoAddr = await reverseGeocode(lat_, lng_).catch(() => ({}));
                    if (geoAddr.village  && !update.village)      update.village      = geoAddr.village;
                    if (geoAddr.town     && !update.town)         update.town         = geoAddr.town;
                    if (geoAddr.district && !update.district)     { update.district = geoAddr.district; update.location = geoAddr.district; }
                    if (geoAddr.state    && !update.state)        update.state        = geoAddr.state;
                    if (geoAddr.pincode  && !update.pincode)      update.pincode      = geoAddr.pincode;
                    if (geoAddr.full     && !update.address_full) update.address_full = geoAddr.full;
                }
            }
        }
    }

    let patchResult = await safeQuery(
        supabase.from('equipment').update(update).eq('id', req.params.id).select(getSelect()).single()
    );
    if (patchResult === null) {
        patchResult = await safeQuery(
            supabase.from('equipment').update(stripExtended(update)).eq('id', req.params.id).select(getSelect()).single()
        );
    }
    const { data, error } = patchResult || {};
    if (error) return res.status(400).json({ error: error.message || 'Failed to update equipment' });

    // Re-index geo
    if (Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))) {
        await indexMachineGeo(data.id, Number(data.latitude), Number(data.longitude));
    }

    return res.json({ data: toMachine(data) });
});

// ─── DELETE /api/v1/machines/:id ─────────────────────────────────────────────
router.delete('/:id', auth(true), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    const uid = req.user?.id || req.user?.sub;
    const { data: existing, error: readErr } = await supabase
        .from('equipment').select('id, owner_id').eq('id', req.params.id).single();
    if (readErr || !existing) return res.status(404).json({ error: 'Machine not found' });
    if (existing.owner_id && uid && String(existing.owner_id) !== String(uid))
        return res.status(403).json({ error: 'Forbidden' });

    const { error } = await supabase.from('equipment').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message || 'Failed to delete equipment' });

    // Remove from Redis GEO
    if (redisClient?.isReady) {
        await redisClient.zRem(MACHINES_GEO_KEY, String(req.params.id)).catch(() => {});
    }

    return res.status(204).send();
});

module.exports = router;
