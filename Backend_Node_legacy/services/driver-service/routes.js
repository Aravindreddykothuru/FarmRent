/**
 * driver-service/routes.js
 * Driver profile management, availability toggling, nearest-driver lookup, and trip controls.
 * Uses Redis GEOADD/GEOSEARCH for spatial queries.
 */
const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/requireRole');
const { validate } = require('../../middleware/validate');
const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');
const { HttpError } = require('../../lib/httpError');
const { getJwtSecret } = require('../../lib/jwtSecret');
const { driverTripStartSchema, driverTripEndSchema } = require('../../validations/schemas');
const { redisClient, getHasGeoSupport } = require('../tracking-service/redisClient');
const { validateGPS } = require('../../lib/gpsValidator');
const { emitBookingStatusChange } = require('../tracking-service/socket');
const lifecycle = require('../booking-service/lifecycle');

const DRIVERS_GEO_KEY = 'drivers:geo';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_DRIVER_SELECT = 'id, vehicle_name, vehicle_type, vehicle_number, is_available, rating, total_trips';

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

const isAdmin = (user) => Boolean(user?.roles?.includes('admin'));

function removeFromGeoIndex(driverId) {
    if (!redisClient?.isReady) return;
    redisClient
        .zRem(DRIVERS_GEO_KEY, String(driverId))
        .catch((err) => logger.warn('[drivers] geo index removal failed', { driverId, error: err.message }));
}

async function driverForUser(userId) {
    const { data, error } = await db().from('drivers').select('id').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, 'DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found. Please register first.');
    return data;
}

// ─── POST /api/v1/drivers/register ────────────────────────────────────────────
// Register (or update) the current user's driver profile with vehicle info
router.post(
    '/register',
    auth(true),
    requireRole('owner', 'admin'),
    asyncHandler(async (req, res) => {
        const { vehicle_name, vehicle_type, vehicle_number, license_number } = req.body || {};
        if (!vehicle_name || !vehicle_type || !vehicle_number) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'vehicle_name, vehicle_type, vehicle_number are required');
        }

        const { data: user, error: userError } = await db().from('users').select('full_name, phone').eq('id', req.user.id).single();
        if (userError) throw userError;
        if (!user.phone) throw new HttpError(400, 'PHONE_REQUIRED', 'Add a phone number to your profile before registering as a driver');

        const { data, error } = await db()
            .from('drivers')
            .upsert(
                {
                    user_id: req.user.id,
                    name: user.full_name,
                    phone: user.phone,
                    vehicle_name,
                    vehicle_type,
                    vehicle_number,
                    license_number: license_number || null,
                },
                { onConflict: 'user_id' },
            )
            .select()
            .single();
        if (error) throw error;

        return res.status(201).json({ success: true, data });
    }),
);

// ─── GET /api/v1/drivers/me ────────────────────────────────────────────────────
router.get(
    '/me',
    auth(true),
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('drivers')
            .select(
                'id, user_id, vehicle_name, vehicle_type, vehicle_number, is_available, location_sharing, current_lat, current_lng, heading, speed, rating, total_trips, created_at, updated_at, users(full_name, email, phone)',
            )
            .eq('user_id', req.user.id)
            .maybeSingle();
        if (error) throw error;
        // Not having a driver profile is an ordinary state for most users, not an error: answer with null.
        if (!data) return res.json({ success: true, data: null });

        return res.json({ success: true, data: { ...data, users: data.users ? { ...data.users, name: data.users.full_name } : null } });
    }),
);

// ─── PATCH /api/v1/drivers/availability ───────────────────────────────────────
router.patch(
    '/availability',
    auth(true),
    asyncHandler(async (req, res) => {
        const { is_available } = req.body || {};
        if (typeof is_available !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', 'is_available (boolean) required');

        const driver = await driverForUser(req.user.id);
        const { data, error } = await db().from('drivers').update({ is_available }).eq('id', driver.id).select().single();
        if (error) throw error;
        if (!is_available) removeFromGeoIndex(driver.id);

        return res.json({ success: true, data });
    }),
);

// ─── PATCH /api/v1/drivers/location ───────────────────────────────────────────
// Update driver GPS position — REST fallback (primary channel is WebSocket)
router.patch(
    '/location',
    auth(true),
    asyncHandler(async (req, res) => {
        const { latitude, longitude, heading = 0, speed = 0, accuracy = 10 } = req.body || {};
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'Valid latitude and longitude required');
        }

        const { valid, reason, flags } = validateGPS({ lat, lng, accuracy, speed, timestamp: Date.now() });
        if (!valid) {
            return res
                .status(422)
                .json({ status: 'error', code: 'GPS_REJECTED', message: 'GPS validation failed', details: { reason, flags } });
        }

        const driver = await driverForUser(req.user.id);
        const { error } = await db().from('drivers').update({ current_lat: lat, current_lng: lng, heading, speed }).eq('id', driver.id);
        if (error) throw error;

        if (redisClient?.isReady && getHasGeoSupport()) {
            await redisClient
                .geoAdd(DRIVERS_GEO_KEY, { longitude: lng, latitude: lat, member: String(driver.id) })
                .catch((err) => logger.warn('[drivers] geo index update failed', { driverId: driver.id, error: err.message }));
        }

        return res.json({ success: true, lat, lng, flags });
    }),
);

// ─── Trips ─────────────────────────────────────────────────────────────────────
// Drivers move a booking through the same lifecycle rules as owners: start needs an approved booking
// assigned to them; ending the trip completes the rental and needs the renter's completion code.

async function driverTransition(req, action, verify) {
    const { booking_id: bookingId } = req.body || {};
    if (!UUID_RE.test(String(bookingId))) throw new HttpError(400, 'VALIDATION_ERROR', 'booking_id required');

    const driver = await driverForUser(req.user.id);
    const { data: booking, error } = await db()
        .from('equipment_rentals')
        .select('id, renter_id, owner_id, driver_id, status, started_at')
        .eq('id', bookingId)
        .maybeSingle();
    if (error) throw error;
    if (!booking || booking.driver_id !== driver.id)
        throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found or not assigned to you');

    const rule = lifecycle.assertTransition(action, booking, lifecycle.relationsTo(booking, req.user, driver.id));
    if (verify) verify(booking);

    const { data: updated, error: updateError } = await db()
        .from('equipment_rentals')
        .update({ status: rule.to, [rule.timestamp]: new Date().toISOString() })
        .eq('id', booking.id)
        .eq('status', booking.status)
        .select()
        .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new HttpError(409, 'BOOKING_CHANGED', 'This booking was just updated. Refresh and try again.');

    const clientStatus = lifecycle.toClientStatus(updated.status);
    emitBookingStatusChange(
        updated.id,
        { bookingId: updated.id, id: updated.id, status: clientStatus },
        [updated.renter_id, updated.owner_id].filter(Boolean),
    );
    return { driver, updated: { ...updated, status: clientStatus } };
}

// ─── POST /api/v1/drivers/trip/start ──────────────────────────────────────────
router.post(
    '/trip/start',
    auth(true),
    validate(driverTripStartSchema),
    asyncHandler(async (req, res) => {
        const { updated } = await driverTransition(req, 'start');
        return res.json({ success: true, data: updated });
    }),
);

// ─── POST /api/v1/drivers/trip/end ────────────────────────────────────────────
router.post(
    '/trip/end',
    auth(true),
    validate(driverTripEndSchema),
    asyncHandler(async (req, res) => {
        const secret = getJwtSecret();
        const { driver, updated } = await driverTransition(req, 'complete', (booking) => {
            if (!req.body.otp) throw new HttpError(400, 'OTP_REQUIRED', "Enter the completion code from the renter's booking page");
            if (!lifecycle.verifyCompletionOtp(booking, req.body.otp, secret)) {
                throw new HttpError(400, 'INVALID_OTP', 'Invalid completion code — check it with the renter');
            }
        });

        const { error: releaseError } = await db().from('drivers').update({ is_available: true }).eq('id', driver.id);
        if (releaseError) logger.warn('[drivers] failed to release driver', { driverId: driver.id, error: releaseError.message });
        const { error: tripError } = await db().rpc('drivers_increment_trips', { driver_id: driver.id });
        if (tripError) logger.warn('[drivers] failed to increment trips', { driverId: driver.id, error: tripError.message });
        removeFromGeoIndex(driver.id);

        return res.json({ success: true, data: updated });
    }),
);

// ─── PATCH /api/v1/drivers/share-location ─────────────────────────────────────
router.patch(
    '/share-location',
    auth(true),
    asyncHandler(async (req, res) => {
        const { sharing } = req.body || {};
        if (typeof sharing !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', 'sharing (boolean) required');

        const driver = await driverForUser(req.user.id);
        const { data, error } = await db()
            .from('drivers')
            .update({ location_sharing: sharing })
            .eq('id', driver.id)
            .select('id, location_sharing')
            .single();
        if (error) throw error;
        if (!sharing) removeFromGeoIndex(driver.id);

        return res.json({ success: true, data });
    }),
);

// ─── GET /api/v1/drivers/nearby ────────────────────────────────────────────────
// Nearest available drivers (?lat=&lng=&radius= km). Signed-in users only; no contact details.
router.get(
    '/nearby',
    auth(true),
    asyncHandler(async (req, res) => {
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);
        const radius = Math.min(Number(req.query.radius) || 50, 200);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'VALIDATION_ERROR', 'lat and lng are required');

        const { data, error } = await db().rpc('find_nearest_available_drivers', {
            p_lat: lat,
            p_lng: lng,
            p_radius_km: radius,
            p_limit: 10,
        });
        if (error) throw error;
        if (!data?.length) return res.json({ success: true, data: [] });

        const distance = new Map(data.map((d) => [d.id, d.distance_km]));
        const { data: drivers, error: driversError } = await db()
            .from('drivers')
            .select(PUBLIC_DRIVER_SELECT)
            .in(
                'id',
                data.map((d) => d.id),
            )
            .eq('location_sharing', true);
        if (driversError) throw driversError;

        const result = (drivers || [])
            .map((d) => ({ ...d, distance_km: Math.round(distance.get(d.id) * 10) / 10 }))
            .sort((a, b) => a.distance_km - b.distance_km);
        return res.json({ success: true, data: result });
    }),
);

// ─── GET /api/v1/drivers ────────────────────────────────────────────────────
// All drivers (admin view)
router.get(
    '/',
    auth(true),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('drivers')
            .select(
                'id, user_id, name, phone, vehicle_name, vehicle_type, vehicle_number, is_available, current_lat, current_lng, rating, total_trips, created_at, users(full_name, email)',
            )
            .order('created_at', { ascending: false })
            .limit(500);
        if (error) throw error;
        return res.json({ success: true, data: data || [] });
    }),
);

// ─── GET /api/v1/drivers/:id ────────────────────────────────────────────────
router.get(
    '/:id',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'DRIVER_NOT_FOUND', 'Driver not found');
        const select = isAdmin(req.user) ? `${PUBLIC_DRIVER_SELECT}, name, phone, user_id` : `${PUBLIC_DRIVER_SELECT}, name`;
        const { data, error } = await db().from('drivers').select(select).eq('id', req.params.id).maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(404, 'DRIVER_NOT_FOUND', 'Driver not found');
        return res.json({ success: true, data });
    }),
);

module.exports = router;
