/**
 * tracking-service/routes.js — REST API for GPS tracking
 *
 * Every read is limited to the parties of the booking (renter, owner, assigned driver) or admins;
 * every write comes from the authenticated driver or equipment owner, never from ids in the payload.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { recordEquipmentPosition } = require('./equipmentPosition');
const { redisClient, getHasGeoSupport } = require('./redisClient');
const { getIo, emitEtaUpdate, canAccessBooking, canAccessDriver } = require('./socket');
const { getRouteWithFallback } = require('../routing-service/osrm');
const { validateGPS } = require('../../lib/gpsValidator');
const { GPSKalmanFilter } = require('../../lib/kalmanGPS');
const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');
const { HttpError } = require('../../lib/httpError');
const { auth } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/asyncHandler');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKABLE_STATUSES = ['approved', 'active', 'return_pending'];
const restKalman = new Map();

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

const emitSafely = (fn, context) => {
    try {
        fn(getIo());
    } catch (err) {
        logger.warn(`[tracking] ${context} realtime emit skipped`, { error: err.message });
    }
};

async function requireBookingAccess(req) {
    const { bookingId } = req.params;
    if (!(await canAccessBooking(req.user, bookingId))) {
        throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    return bookingId;
}

async function driverIdForUser(userId) {
    const { data, error } = await db().from('drivers').select('id').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, 'DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found');
    return data.id;
}

// ─── POST /api/v1/tracking/driver-location ─────────────────────────────────
router.post(
    '/driver-location',
    auth(true),
    asyncHandler(async (req, res) => {
        const { bookingId, latitude, longitude, heading = 0, speed = 0, accuracy = 10 } = req.body || {};
        const lat = Number(latitude);
        const lng = Number(longitude);
        const now = Date.now();

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'Valid latitude and longitude required');
        }

        const { valid, reason, flags } = validateGPS({ lat, lng, accuracy, speed, timestamp: now });
        if (!valid) {
            return res
                .status(422)
                .json({ status: 'error', code: 'GPS_REJECTED', message: 'GPS validation failed', details: { reason, flags } });
        }

        const driverId = await driverIdForUser(req.user.id);
        let rentalId = null;
        let equipmentId = null;
        if (bookingId) {
            if (!UUID_RE.test(String(bookingId))) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
            const { data: booking, error } = await db()
                .from('equipment_rentals')
                .select('id, equipment_id')
                .eq('id', bookingId)
                .eq('driver_id', driverId)
                .in('status', TRACKABLE_STATUSES)
                .maybeSingle();
            if (error) throw error;
            if (!booking) throw new HttpError(403, 'FORBIDDEN', 'This booking is not assigned to you');
            rentalId = booking.id;
            equipmentId = booking.equipment_id;
        }

        if (!restKalman.has(driverId)) restKalman.set(driverId, new GPSKalmanFilter());
        const smoothed = restKalman.get(driverId).filter(lat, lng, accuracy);

        const trackingData = {
            driverId,
            latitude: smoothed.lat,
            longitude: smoothed.lng,
            rawLat: lat,
            rawLng: lng,
            heading: Number(heading),
            speed: Number(speed),
            accuracy: Number(accuracy),
            flags,
            timestamp: now,
        };

        const { error: positionError } = await db()
            .from('drivers')
            .update({
                current_lat: smoothed.lat,
                current_lng: smoothed.lng,
                heading: Number(heading),
                speed: Number(speed),
            })
            .eq('id', driverId);
        if (positionError) throw positionError;

        if (redisClient?.isReady) {
            const pipeline = redisClient.multi();
            if (getHasGeoSupport()) {
                pipeline.geoAdd('drivers:geo', { longitude: smoothed.lng, latitude: smoothed.lat, member: String(driverId) });
            }
            pipeline.hSet(`driver_latest:${driverId}`, 'location', JSON.stringify(trackingData));
            pipeline.expire(`driver_latest:${driverId}`, 1800);
            if (rentalId) {
                pipeline.hSet(`booking_latest:${rentalId}`, 'location', JSON.stringify(trackingData));
                pipeline.expire(`booking_latest:${rentalId}`, 1800);
            }
            await pipeline.exec().catch((err) => logger.warn('[tracking] location cache write failed', { driverId, error: err.message }));
        }

        if (rentalId) {
            const { error: trailError } = await db()
                .from('gps_locations')
                .insert({
                    rental_id: rentalId,
                    equipment_id: equipmentId,
                    location: `POINT(${lng} ${lat})`,
                    heading: Number(heading),
                    speed_kmh: Number(speed),
                    accuracy: Number(accuracy),
                    recorded_at: new Date(now).toISOString(),
                });
            if (trailError) logger.warn('[tracking] breadcrumb insert failed', { rentalId, error: trailError.message });
        }

        emitSafely((io) => {
            const ns = io.of('/tracking');
            if (rentalId) ns.to(`booking_${rentalId}`).emit('location_update', trackingData);
            ns.to(`delivery_${driverId}`).emit('location_update', trackingData);
        }, 'driver-location');

        return res.json({ success: true, data: trackingData });
    }),
);

// ─── GET /api/v1/tracking/booking/:bookingId/location ──────────────────────
router.get(
    '/booking/:bookingId/location',
    auth(true),
    asyncHandler(async (req, res) => {
        const bookingId = await requireBookingAccess(req);

        if (redisClient?.isReady) {
            try {
                const cached = await redisClient.hGet(`booking_latest:${bookingId}`, 'location');
                if (cached) return res.json({ success: true, source: 'redis', data: JSON.parse(cached) });
            } catch (err) {
                logger.warn('[tracking] cached location read failed', { bookingId, error: err.message });
            }
        }

        const { data: booking, error } = await db()
            .from('equipment_rentals')
            .select('driver_id, drivers(current_lat, current_lng, heading, speed, updated_at)')
            .eq('id', bookingId)
            .single();
        if (error) throw error;
        if (!booking.driver_id || booking.drivers?.current_lat == null) return res.json({ success: true, data: null });

        const d = booking.drivers;
        return res.json({
            success: true,
            source: 'db',
            data: {
                driverId: booking.driver_id,
                latitude: d.current_lat,
                longitude: d.current_lng,
                heading: d.heading || 0,
                speed: d.speed || 0,
                timestamp: d.updated_at ? new Date(d.updated_at).getTime() : null,
            },
        });
    }),
);

// ─── GET /api/v1/tracking/booking/:bookingId/route ─────────────────────────
router.get(
    '/booking/:bookingId/route',
    auth(true),
    asyncHandler(async (req, res) => {
        const bookingId = await requireBookingAccess(req);

        const { data: booking, error } = await db()
            .from('equipment_rentals')
            .select('pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, drivers(current_lat, current_lng)')
            .eq('id', bookingId)
            .single();
        if (error) throw error;

        const driver = booking.drivers;
        const destLat = booking.pickup_lat ?? booking.dropoff_lat;
        const destLng = booking.pickup_lng ?? booking.dropoff_lng;
        if (driver?.current_lat == null || destLat == null) return res.json({ success: true, route: null });

        const route = await getRouteWithFallback(driver.current_lat, driver.current_lng, destLat, destLng);
        if (route) {
            emitEtaUpdate(bookingId, {
                bookingId,
                eta_minutes: route.duration_minutes,
                distance_km: route.distance_km,
                route_geometry: route.geometry,
                refreshedAt: Date.now(),
            });
        }

        return res.json({ success: true, route });
    }),
);

// ─── GET /api/v1/tracking/booking/:bookingId/history ───────────────────────
router.get(
    '/booking/:bookingId/history',
    auth(true),
    asyncHandler(async (req, res) => {
        const bookingId = await requireBookingAccess(req);

        // Coordinates come out of PostGIS (db/migrations/0004): the geography column itself reaches the API as
        // hex EWKB, not as something it can read.
        const { data, error } = await db().rpc('rental_location_history', { p_rental_id: bookingId, p_limit: 5000 });
        if (error) throw error;

        const mapped = (data || []).map((r) => ({
            latitude: r.latitude,
            longitude: r.longitude,
            heading: r.heading,
            speed: r.speed_kmh,
            accuracy: r.accuracy,
            altitude: r.altitude,
            gps_flags: [],
            created_at: r.recorded_at,
        }));

        return res.json({ success: true, data: mapped });
    }),
);

// ─── GET /api/v1/tracking/driver/:driverId/status ──────────────────────────
router.get(
    '/driver/:driverId/status',
    auth(true),
    asyncHandler(async (req, res) => {
        const { driverId } = req.params;
        if (!(await canAccessDriver(req.user, driverId))) throw new HttpError(404, 'DRIVER_NOT_FOUND', 'Driver not found');

        let presence = null;
        let lastLocation = null;
        if (redisClient?.isReady) {
            try {
                const status = await redisClient.hGetAll(`driver_socket:${driverId}`);
                presence = status && Object.keys(status).length ? status : null;
                const latest = await redisClient.hGet(`driver_latest:${driverId}`, 'location');
                lastLocation = latest ? JSON.parse(latest) : null;
            } catch (err) {
                logger.warn('[tracking] driver presence read failed', { driverId, error: err.message });
            }
        }

        return res.json({
            success: true,
            driverId,
            isOnline: presence?.isOnline === '1',
            connectedAt: presence?.connectedAt ? Number(presence.connectedAt) : null,
            lastLocation,
        });
    }),
);

// ─── POST /api/v1/tracking/update (legacy REST endpoint) ───────────────────
// Publishes the caller's own driver position to their delivery room.
router.post(
    '/update',
    auth(true),
    asyncHandler(async (req, res) => {
        const { latitude, longitude, heading = 0, speed = 0 } = req.body || {};
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'latitude and longitude are required');
        }
        const deliveryId = await driverIdForUser(req.user.id);
        const trackingData = { deliveryId, latitude: lat, longitude: lng, heading, speed, timestamp: Date.now() };

        if (redisClient?.isReady) {
            await redisClient
                .hSet(`delivery_info:${deliveryId}`, 'latest', JSON.stringify(trackingData))
                .catch((err) => logger.warn('[tracking] delivery cache write failed', { deliveryId, error: err.message }));
        }
        emitSafely((io) => io.of('/tracking').to(`delivery_${deliveryId}`).emit('location_update', trackingData), 'update');

        return res.json({ success: true, data: trackingData });
    }),
);

// ─── POST /api/v1/tracking/equipment-update — owner's position update (REST fallback for the socket) ─────
// With booking_id the position joins that rental's trail and is pushed to the booking room; without it the
// owner is moving the listing's own location.
router.post(
    '/equipment-update',
    auth(true),
    asyncHandler(async (req, res) => {
        const { equipment_id, booking_id, lat, lng, speed, heading, accuracy, altitude } = req.body || {};
        if (!UUID_RE.test(String(equipment_id))) throw new HttpError(400, 'VALIDATION_ERROR', 'equipment_id, lat, and lng are required');

        const { data: equipment, error } = await db().from('equipment').select('owner_id').eq('id', equipment_id).maybeSingle();
        if (error) throw error;
        if (!equipment || equipment.owner_id !== req.user.id) {
            throw new HttpError(403, 'FORBIDDEN', 'Not authorised to update this equipment location');
        }

        const point = await recordEquipmentPosition({
            equipmentId: equipment_id,
            bookingId: booking_id,
            latitude: lat,
            longitude: lng,
            speed,
            heading,
            accuracy,
            altitude,
            source: 'mobile_gps',
        });
        return res.json({ success: true, data: point });
    }),
);

// ─── POST /api/v1/tracking/device-update — SIM-based hardware GPS trackers ───────────────────────────────
// No user session: the device proves itself with the shared secret in x-device-secret (TRACKING_DEVICE_SECRET).
const DEVICE_MIN_INTERVAL_MS = 10_000;
const DEVICE_ID_RE = /^[\w.:-]{1,64}$/;
const deviceLastSeen = new Map(); // used only while Redis is unavailable

function deviceSecretMatches(expected, received) {
    if (typeof received !== 'string' || !received) return false;
    // Compare fixed-length digests so neither the value nor its length leaks through timing.
    const digest = (value) => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(expected), digest(received));
}

async function allowDevicePost(deviceId) {
    if (redisClient?.isReady) {
        const set = await redisClient.set(`device_rl:${deviceId}`, '1', { NX: true, PX: DEVICE_MIN_INTERVAL_MS });
        return set === 'OK';
    }
    const now = Date.now();
    if (now - (deviceLastSeen.get(deviceId) || 0) < DEVICE_MIN_INTERVAL_MS) return false;
    deviceLastSeen.set(deviceId, now);
    return true;
}

router.post(
    '/device-update',
    asyncHandler(async (req, res) => {
        const expected = process.env.TRACKING_DEVICE_SECRET;
        if (!expected) throw new HttpError(503, 'DEVICE_TRACKING_DISABLED', 'Device tracking is not enabled on this server');
        if (!deviceSecretMatches(expected, req.get('x-device-secret'))) {
            throw new HttpError(401, 'INVALID_DEVICE_SECRET', 'Invalid or missing device secret');
        }

        const { device_id, equipment_id, booking_id, lat, lng, speed, heading, altitude, accuracy, timestamp } = req.body || {};
        if (typeof device_id !== 'string' || !DEVICE_ID_RE.test(device_id)) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'device_id is required (letters, digits, . _ : -, at most 64)');
        }
        if (!UUID_RE.test(String(equipment_id)) || !UUID_RE.test(String(booking_id))) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'equipment_id and booking_id must be UUIDs');
        }
        const latitude = Number(lat);
        const longitude = Number(lng);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'Valid lat (-90..90) and lng (-180..180) are required');
        }
        if (!(await allowDevicePost(device_id))) {
            res.set('Retry-After', String(DEVICE_MIN_INTERVAL_MS / 1000));
            throw new HttpError(429, 'RATE_LIMITED', 'Send at most one position every 10 seconds per device');
        }

        const point = await recordEquipmentPosition({
            equipmentId: equipment_id,
            bookingId: booking_id,
            latitude,
            longitude,
            speed,
            heading,
            altitude,
            accuracy,
            source: 'vehicle_gps',
            recordedAt: timestamp,
        });
        return res.json({ success: true, data: { ...point, deviceId: device_id, received_at: new Date().toISOString() } });
    }),
);

module.exports = router;
