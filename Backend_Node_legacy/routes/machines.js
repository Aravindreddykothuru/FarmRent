/**
 * Equipment listings — /api/v1/machines
 *
 * Rows live in `equipment`; responses use the nested "Machine" shape the web client renders.
 * The exact pickup point is only returned to the owner (renters receive it through a confirmed booking).
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const { HttpError } = require('../lib/httpError');
const { reverseGeocode } = require('../lib/geocoder');
const { indexMachine, deleteMachine, isEsReady, searchMachines } = require('../lib/elasticsearch');
const { asyncHandler } = require('../middleware/asyncHandler');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validate } = require('../middleware/validate');
const { searchLimiter } = require('../middleware/redisRateLimiter');
const { redisClient, getHasGeoSupport } = require('../services/tracking-service/redisClient');
const { machineCreateSchema, machineUpdateSchema, machineListQuerySchema } = require('../validations/schemas');

const MACHINES_GEO_KEY = 'machines:geo';
const DETAIL_TTL_SEC = 600;
const LIST_TTL_SEC = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_BOOKING_STATUSES = ['requested', 'approved', 'active', 'return_pending'];
const LISTING_ROLES = ['owner', 'farmer', 'admin'];

const PUBLIC_SELECT = [
    'id',
    'owner_id',
    'name',
    'category',
    'description',
    'brand',
    'horsepower',
    'year_of_mfg',
    'daily_rate',
    'price_weekly',
    'price_monthly',
    'deposit_amount',
    'operator_included',
    'images',
    'features',
    'specifications',
    'status',
    'is_verified',
    'is_deleted',
    'latitude',
    'longitude',
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
    'updated_at',
].join(', ');
const OWNER_SELECT = `${PUBLIC_SELECT}, pickup_lat, pickup_lng, pickup_address, pickup_landmark`;

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

const toNumberOrNull = (value) => (value == null ? null : Number(value));
const isAdmin = (user) => Boolean(user?.roles?.includes('admin'));

function toMachine(row, { includePickup = false } = {}) {
    const dailyRate = Number(row.daily_rate) || 0;
    const lat = toNumberOrNull(row.latitude);
    const lng = toNumberOrNull(row.longitude);
    const machine = {
        id: row.id,
        _id: row.id,
        name: row.name,
        type: row.category,
        description: row.description || '',
        status: row.status === 'active' ? 'available' : row.status,
        owner: row.owner_id,
        owner_id: row.owner_id,
        brand: row.brand || '',
        images: row.images || [],
        features: row.features || [],
        specifications: {
            ...(row.specifications || {}),
            ...(row.horsepower != null ? { power: row.horsepower } : {}),
            ...(row.year_of_mfg != null ? { year: row.year_of_mfg } : {}),
        },
        pricing: {
            baseRatePerDay: dailyRate,
            baseRatePerHour: Math.round(dailyRate / 8),
            weeklyRate: toNumberOrNull(row.price_weekly),
            monthlyRate: toNumberOrNull(row.price_monthly),
            securityDeposit: Number(row.deposit_amount) || 0,
            operatorIncluded: Boolean(row.operator_included),
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
        ratings: { average: Number(row.avg_rating) || 0, count: Number(row.rating_count) || 0 },
        latitude: lat,
        longitude: lng,
        is_verified: row.is_verified,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
    if (includePickup) {
        machine.pickup =
            row.pickup_lat != null && row.pickup_lng != null
                ? { lat: row.pickup_lat, lng: row.pickup_lng, address: row.pickup_address || '', landmark: row.pickup_landmark || null }
                : null;
    }
    return machine;
}

/** Maps validated Machine-shaped input onto equipment columns; only provided fields are set. */
function toEquipmentRow(input) {
    const row = {};
    const set = (column, value) => {
        if (value !== undefined) row[column] = value;
    };

    set('name', input.name);
    set('category', input.type);
    set('description', input.description);
    set('brand', input.brand);
    if (input.status) row.status = input.status === 'available' ? 'active' : input.status;

    if (input.pricing) {
        set('daily_rate', input.pricing.baseRatePerDay);
        set('price_weekly', input.pricing.weeklyRate);
        set('price_monthly', input.pricing.monthlyRate);
        set('deposit_amount', input.pricing.securityDeposit);
        set('operator_included', input.pricing.operatorIncluded);
    }

    if (input.location) {
        const loc = input.location;
        set('address_full', loc.full);
        set('village', loc.village);
        set('town', loc.town);
        set('district', loc.district);
        set('state', loc.state);
        set('pincode', loc.pincode);
        if (loc.coordinates) {
            [row.longitude, row.latitude] = loc.coordinates.coordinates;
        }
    }

    set('pickup_lat', input.pickup_lat);
    set('pickup_lng', input.pickup_lng);
    set('pickup_address', input.pickup_address);
    set('pickup_landmark', input.pickup_landmark);
    set('service_radius_km', input.service_radius_km);
    set('service_pincodes', input.service_pincodes);
    set('images', input.images);
    set('features', input.features);
    set('specifications', input.specifications);
    return row;
}

/** Fills missing address parts from coordinates. Geocoding is optional enrichment, never a reason to fail. */
async function fillAddressFromCoordinates(row) {
    if (row.latitude == null || row.longitude == null || (row.district && row.state)) return;
    try {
        const address = await reverseGeocode(row.latitude, row.longitude);
        for (const [column, key] of [
            ['address_full', 'full'],
            ['village', 'village'],
            ['town', 'town'],
            ['district', 'district'],
            ['state', 'state'],
            ['pincode', 'pincode'],
        ]) {
            if (!row[column] && address?.[key]) row[column] = address[key];
        }
    } catch (err) {
        logger.warn('[machines] reverse geocoding failed; saving without derived address', { error: err.message });
    }
}

// ── Caches ───────────────────────────────────────────────────────────────────

async function cacheGet(key) {
    if (!redisClient?.isReady) return null;
    try {
        const cached = await redisClient.get(key);
        return cached ? JSON.parse(cached) : null;
    } catch (err) {
        logger.warn('[machines] cache read failed', { key, error: err.message });
        return null;
    }
}

function cacheSet(key, ttlSec, value) {
    if (!redisClient?.isReady) return;
    redisClient
        .setEx(key, ttlSec, JSON.stringify(value))
        .catch((err) => logger.warn('[machines] cache write failed', { key, error: err.message }));
}

async function listCacheVersion() {
    if (!redisClient?.isReady) return '0';
    try {
        return (await redisClient.get('machine:list_version')) || '0';
    } catch (err) {
        logger.warn('[machines] list cache version read failed', { error: err.message });
        return '0';
    }
}

async function afterListingChange(row, { removed = false } = {}) {
    if (redisClient?.isReady) {
        const ops = [redisClient.incr('machine:list_version'), redisClient.del(`machine:detail:${row.id}`)];
        if (getHasGeoSupport()) {
            ops.push(
                removed || row.latitude == null || row.longitude == null
                    ? redisClient.zRem(MACHINES_GEO_KEY, String(row.id))
                    : redisClient.geoAdd(MACHINES_GEO_KEY, {
                          longitude: Number(row.longitude),
                          latitude: Number(row.latitude),
                          member: String(row.id),
                      }),
            );
        }
        const results = await Promise.allSettled(ops);
        results
            .filter((r) => r.status === 'rejected')
            .forEach((r) => logger.warn('[machines] cache/geo index update failed', { id: row.id, error: r.reason?.message }));
    }
    if (removed) await deleteMachine(row.id);
    else await indexMachine(row);
}

async function loadOwnedEquipment(req) {
    const { id } = req.params;
    if (!UUID_RE.test(id)) throw new HttpError(404, 'MACHINE_NOT_FOUND', 'Machine not found');
    const { data, error } = await db().from('equipment').select('id, owner_id, is_deleted').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || data.is_deleted) throw new HttpError(404, 'MACHINE_NOT_FOUND', 'Machine not found');
    if (data.owner_id !== req.user.id && !isAdmin(req.user)) {
        throw new HttpError(403, 'FORBIDDEN', 'You can only change your own listings');
    }
    return data;
}

// Free-text search goes into a PostgREST or() filter, whose syntax uses , ( ) . and quotes.
const searchTerm = (q) =>
    (q || '')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

// ─── GET /api/v1/machines ─────────────────────────────────────────────────────
router.get(
    '/',
    searchLimiter,
    validate(machineListQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        const params = req.query;
        const uid = req.user?.id;
        const mine = params.owner === 'me';
        if (mine && !uid) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in to see your listings');

        if (!mine && (await isEsReady())) {
            try {
                const results = await searchMachines({
                    q: params.q,
                    type: params.type,
                    lat: params.lat,
                    lon: params.lng,
                    radius: `${params.radius || 50}km`,
                    limit: params.limit,
                    offset: params.offset,
                });
                return res.json({ data: results, source: 'elasticsearch' });
            } catch (err) {
                logger.warn('[machines] Elasticsearch search failed, using database', { error: err.message });
            }
        }

        const cacheKey = mine
            ? null
            : `machine:list:v${await listCacheVersion()}:${crypto.createHash('md5').update(JSON.stringify(params)).digest('hex')}`;
        if (cacheKey) {
            const cached = await cacheGet(cacheKey);
            if (cached) return res.json({ data: cached, source: 'redis' });
        }

        let query = db().from('equipment').select(PUBLIC_SELECT).eq('is_deleted', false);
        if (mine) {
            query = query.eq('owner_id', uid);
            if (params.status) query = query.eq('status', params.status === 'available' ? 'active' : params.status);
        } else {
            query = query.eq('is_verified', true).eq('status', params.status && params.status !== 'available' ? params.status : 'active');
        }
        if (params.type) query = query.ilike('category', `%${searchTerm(params.type).replace(/ /g, '-')}%`);
        const term = searchTerm(params.q);
        if (term) {
            query = query.or(
                ['name', 'description', 'brand', 'district', 'village', 'town'].map((column) => `${column}.ilike.*${term}*`).join(','),
            );
        }

        const { data, error } = await query
            .order('created_at', { ascending: false })
            .range(params.offset, params.offset + params.limit - 1);
        if (error) throw error;

        const machines = (data || []).map((row) => toMachine(row));
        if (cacheKey) cacheSet(cacheKey, LIST_TTL_SEC, machines);
        return res.json({ data: machines, source: 'db' });
    }),
);

// ─── GET /api/v1/machines/nearby ─────────────────────────────────────────────
router.get(
    '/nearby',
    asyncHandler(async (req, res) => {
        const lat = Number.parseFloat(req.query.lat);
        const lng = Number.parseFloat(req.query.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'Valid lat and lng are required');
        }
        const radius = Math.min(Number.parseFloat(req.query.radius) || 50, 500);

        const { data, error } = await db().rpc('find_nearby_equipment', { p_lat: lat, p_lng: lng, p_radius_km: radius });
        if (error) throw error;

        const type = req.query.type ? String(req.query.type).toLowerCase() : null;
        const machines = (data || []).map((row) => toMachine(row)).filter((m) => !type || m.type.includes(type));
        return res.json({ data: machines, source: 'db' });
    }),
);

// ─── GET /api/v1/machines/:id ─────────────────────────────────────────────────
router.get(
    '/:id',
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!UUID_RE.test(id)) throw new HttpError(404, 'MACHINE_NOT_FOUND', 'Machine not found');

        // Signed-in callers may be the owner, who gets the private pickup details — never serve them the shared cache.
        if (!req.user) {
            const cached = await cacheGet(`machine:detail:${id}`);
            if (cached) return res.json({ data: cached, source: 'redis' });
        }

        const { data, error } = await db().from('equipment').select(OWNER_SELECT).eq('id', id).maybeSingle();
        if (error) throw error;
        const privileged = Boolean(data && req.user && (data.owner_id === req.user.id || isAdmin(req.user)));
        if (!data || (!privileged && (data.is_deleted || !data.is_verified))) {
            throw new HttpError(404, 'MACHINE_NOT_FOUND', 'Machine not found');
        }

        const machine = toMachine(data, { includePickup: privileged });
        if (!privileged) cacheSet(`machine:detail:${id}`, DETAIL_TTL_SEC, machine);
        return res.json({ data: machine, source: 'db' });
    }),
);

// ─── POST /api/v1/machines ────────────────────────────────────────────────────
router.post(
    '/',
    auth(true),
    requireRole(...LISTING_ROLES),
    validate(machineCreateSchema),
    asyncHandler(async (req, res) => {
        const row = {
            ...toEquipmentRow(req.body),
            owner_id: req.user.id,
            status: req.body.status && req.body.status !== 'available' ? req.body.status : 'active',
            // Listings go live immediately (existing product behaviour); admins moderate via /api/v1/admin/machines.
            is_verified: true,
        };
        await fillAddressFromCoordinates(row);

        const { data, error } = await db().from('equipment').insert(row).select(OWNER_SELECT).single();
        if (error) throw error;

        await afterListingChange(data);
        return res.status(201).json({ data: toMachine(data, { includePickup: true }) });
    }),
);

// ─── PATCH /api/v1/machines/:id ──────────────────────────────────────────────
router.patch(
    '/:id',
    auth(true),
    requireRole(...LISTING_ROLES),
    validate(machineUpdateSchema),
    asyncHandler(async (req, res) => {
        const existing = await loadOwnedEquipment(req);
        const changes = toEquipmentRow(req.body);
        if (Object.keys(changes).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No valid fields to update');
        await fillAddressFromCoordinates(changes);

        const { data, error } = await db().from('equipment').update(changes).eq('id', existing.id).select(OWNER_SELECT).single();
        if (error) throw error;

        await afterListingChange(data);
        return res.json({ data: toMachine(data, { includePickup: true }) });
    }),
);

// ─── DELETE /api/v1/machines/:id ─────────────────────────────────────────────
router.delete(
    '/:id',
    auth(true),
    requireRole(...LISTING_ROLES),
    asyncHandler(async (req, res) => {
        const existing = await loadOwnedEquipment(req);

        const { count, error: bookingError } = await db()
            .from('equipment_rentals')
            .select('id', { count: 'exact', head: true })
            .eq('equipment_id', existing.id)
            .in('status', LIVE_BOOKING_STATUSES);
        if (bookingError) throw bookingError;
        if (count > 0) {
            throw new HttpError(
                409,
                'HAS_ACTIVE_BOOKINGS',
                'This listing has upcoming or active bookings. Resolve them before removing it.',
            );
        }

        // Soft delete: a hard delete would null equipment_id on past rentals and break their history and invoices.
        const { error } = await db()
            .from('equipment')
            .update({ is_deleted: true, status: 'inactive', deleted_at: new Date().toISOString() })
            .eq('id', existing.id);
        if (error) throw error;

        await afterListingChange(existing, { removed: true });
        return res.status(204).send();
    }),
);

module.exports = router;
