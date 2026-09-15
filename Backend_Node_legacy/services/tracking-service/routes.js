/**
 * tracking-service/routes.js — REST API for GPS tracking
 *
 * Every read is limited to the parties of the booking (renter, owner, assigned driver) or admins;
 * every write comes from the authenticated driver or equipment owner, never from ids in the payload.
 */

const express = require('express');
const router = express.Router();
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

        const { data, error } = await db()
            .from('gps_locations')
            .select('location, heading, speed_kmh, accuracy, recorded_at')
            .eq('rental_id', bookingId)
            .order('recorded_at', { ascending: true })
            .limit(5000);
        if (error) throw error;

        const mapped = (data || []).map((r) => {
            let lat = null;
            let lng = null;
            if (r.location?.coordinates) {
                [lng, lat] = r.location.coordinates;
            } else if (typeof r.location === 'string') {
                const match = r.location.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
                if (match) {
                    lng = parseFloat(match[1]);
                    lat = parseFloat(match[2]);
                }
            }
            return {
                latitude: lat,
                longitude: lng,
                heading: r.heading,
                speed: r.speed_kmh,
                accuracy: r.accuracy,
                gps_flags: [],
                created_at: r.recorded_at,
            };
        });

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

// ─── POST /api/v1/tracking/equipment-update — live equipment GPS update ───────
router.post(
    '/equipment-update',
    auth(true),
    asyncHandler(async (req, res) => {
        const { equipment_id, lat, lng, timestamp } = req.body || {};
        const latitude = Number(lat);
        const longitude = Number(lng);

        if (!UUID_RE.test(String(equipment_id)) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'equipment_id, lat, and lng are required');
        }

        const { data: equipment, error } = await db().from('equipment').select('owner_id').eq('id', equipment_id).maybeSingle();
        if (error) throw error;
        if (!equipment || equipment.owner_id !== req.user.id) {
            throw new HttpError(403, 'FORBIDDEN', 'Not authorised to update this equipment location');
        }

        // location_point is derived from latitude/longitude by a database trigger.
        const { error: updateError } = await db().from('equipment').update({ latitude, longitude }).eq('id', equipment_id);
        if (updateError) throw updateError;

        emitSafely(
            (io) =>
                io
                    .of('/tracking')
                    .to(`tracking:${equipment_id}`)
                    .emit('equipment:location', {
                        equipment_id,
                        lat: latitude,
                        lng: longitude,
                        timestamp: timestamp || Date.now(),
                    }),
            'equipment-update',
        );

        return res.json({ success: true });
    }),
);

module.exports = router;
