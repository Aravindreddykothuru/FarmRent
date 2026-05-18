/**
 * tracking-service/routes.js — REST API for GPS tracking
 *
 * Primary transport is WebSocket (socket.js).
 * These REST endpoints serve as:
 *   1. Fallback when WS is unavailable (poor network)
 *   2. Initial state load (last known position, current route, trip history)
 *   3. Server-side ETA refresh trigger
 */

const express = require('express');
const router  = express.Router();
const { redisClient } = require('./redisClient');
const { getIo, emitEtaUpdate } = require('./socket');
const { getRouteWithFallback } = require('../routing-service/osrm');
const { validateGPS } = require('../../lib/gpsValidator');
const { GPSKalmanFilter } = require('../../lib/kalmanGPS');
const supabase = require('../../lib/supabase');
const { auth } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/asyncHandler');

// Per-driver Kalman filters for REST fallback path
const restKalman = new Map();

// ─── POST /api/v1/tracking/driver-location ─────────────────────────────────
// REST fallback: driver pushes GPS when WebSocket unavailable
router.post('/driver-location', auth(true), asyncHandler(async (req, res) => {
    const { bookingId, latitude, longitude, heading = 0, speed = 0, accuracy = 10 } = req.body;
    const userId = req.user?.id;
    const lat = Number(latitude);
    const lng = Number(longitude);
    const now = Date.now();

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'Valid latitude and longitude required' });
    }

    // Validate GPS point
    const { valid, reason, flags } = validateGPS({ lat, lng, accuracy, speed, timestamp: now });
    if (!valid) {
        return res.status(422).json({ error: 'GPS validation failed', reason, flags });
    }

    // Resolve driverId
    let driverId = null;
    if (supabase) {
        const { data } = await supabase
            .from('drivers').select('id').eq('user_id', userId).single();
        driverId = data?.id;
    }

    // Apply Kalman filter
    if (!restKalman.has(driverId)) restKalman.set(driverId, new GPSKalmanFilter());
    const smoothed = restKalman.get(driverId).filter(lat, lng, accuracy);

    const trackingData = {
        driverId, latitude: smoothed.lat, longitude: smoothed.lng,
        rawLat: lat, rawLng: lng,
        heading: Number(heading), speed: Number(speed), accuracy: Number(accuracy),
        flags, timestamp: now,
    };

    // Update DB position
    if (supabase && driverId) {
        await supabase.from('drivers').update({
            current_lat: smoothed.lat, current_lng: smoothed.lng,
            heading: Number(heading), speed: Number(speed),
        }).eq('id', driverId).then(null, () => {});
    }

    // Update Redis GEO + cache
    if (redisClient?.isReady && driverId) {
        const pipeline = redisClient.multi();
        pipeline.geoAdd('drivers:geo', { longitude: smoothed.lng, latitude: smoothed.lat, member: String(driverId) });
        pipeline.hSet(`driver_latest:${driverId}`, 'location', JSON.stringify(trackingData));
        pipeline.expire(`driver_latest:${driverId}`, 1800);
        if (bookingId) {
            pipeline.hSet(`booking_latest:${bookingId}`, 'location', JSON.stringify(trackingData));
            pipeline.expire(`booking_latest:${bookingId}`, 1800);
        }
        await pipeline.exec().catch(() => {});
    }

    // Persist trip location
    if (supabase && bookingId && driverId) {
        supabase.from('trip_locations').insert({
            booking_id: bookingId, driver_id: driverId,
            latitude: smoothed.lat, longitude: smoothed.lng,
            heading: Number(heading), speed: Number(speed),
            accuracy: Number(accuracy), gps_flags: flags,
        }).then(() => {}).catch(() => {});
    }

    // Broadcast via Socket.IO
    try {
        const io = getIo();
        const ns = io.of('/tracking');
        if (bookingId) ns.to(`booking_${bookingId}`).emit('location_update', trackingData);
        if (driverId)  ns.to(`delivery_${driverId}`).emit('location_update', trackingData);
    } catch { /* WS not critical for REST path */ }

    return res.json({ success: true, data: trackingData });
}));

// ─── GET /api/v1/tracking/booking/:bookingId/location ──────────────────────
// Last known driver position for a booking (Redis → DB fallback)
router.get('/booking/:bookingId/location', asyncHandler(async (req, res) => {
    const { bookingId } = req.params;

    // Try Redis first (sub-millisecond)
    if (redisClient?.isReady) {
        try {
            const cached = await redisClient.hGet(`booking_latest:${bookingId}`, 'location');
            if (cached) {
                return res.json({ success: true, source: 'redis', data: JSON.parse(cached) });
            }
        } catch { /* fallthrough */ }
    }

    // DB fallback
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data: booking } = await supabase
        .from('bookings')
        .select('driver_id, drivers(current_lat, current_lng, heading, speed)')
        .eq('id', bookingId)
        .single();

    if (!booking?.driver_id) return res.json({ success: true, data: null });

    const d = booking.drivers;
    return res.json({
        success: true, source: 'db',
        data: {
            driverId:  booking.driver_id,
            latitude:  d?.current_lat,
            longitude: d?.current_lng,
            heading:   d?.heading || 0,
            speed:     d?.speed   || 0,
            timestamp: Date.now(),
        },
    });
}));

// ─── GET /api/v1/tracking/booking/:bookingId/route ─────────────────────────
// Current real-road route from driver to pickup
router.get('/booking/:bookingId/route', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data: booking } = await supabase
        .from('bookings')
        .select('pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, drivers(current_lat, current_lng)')
        .eq('id', req.params.bookingId)
        .single();

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const driver = booking.drivers;
    if (!driver?.current_lat) return res.json({ success: true, route: null });

    const destLat = booking.pickup_lat  || booking.dropoff_lat;
    const destLng = booking.pickup_lng  || booking.dropoff_lng;

    const route = await getRouteWithFallback(
        driver.current_lat, driver.current_lng, destLat, destLng
    );

    // Push ETA update via socket
    if (route) {
        emitEtaUpdate(req.params.bookingId, {
            bookingId:        req.params.bookingId,
            eta_minutes:      route.duration_minutes,
            distance_km:      route.distance_km,
            route_geometry:   route.geometry,
            refreshedAt:      Date.now(),
        });
    }

    return res.json({ success: true, route });
}));

// ─── GET /api/v1/tracking/booking/:bookingId/history ───────────────────────
// Full GPS trail for a trip (for replay / analytics)
router.get('/booking/:bookingId/history', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data, error } = await supabase
        .from('trip_locations')
        .select('latitude, longitude, heading, speed, accuracy, gps_flags, created_at')
        .eq('booking_id', req.params.bookingId)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
}));

// ─── GET /api/v1/tracking/driver/:driverId/status ──────────────────────────
// Driver online status, last position, current booking
router.get('/driver/:driverId/status', asyncHandler(async (req, res) => {
    const { driverId } = req.params;
    let redisStatus = null;

    if (redisClient?.isReady) {
        try {
            const s = await redisClient.hGetAll(`driver_socket:${driverId}`);
            redisStatus = s && Object.keys(s).length ? s : null;
        } catch { /* ignore */ }
    }

    const latestLocation = redisClient?.isReady
        ? JSON.parse(await redisClient.hGet(`driver_latest:${driverId}`, 'location').catch(() => 'null') || 'null')
        : null;

    return res.json({
        success: true,
        driverId,
        isOnline:   redisStatus?.isOnline === '1',
        connectedAt: redisStatus?.connectedAt ? Number(redisStatus.connectedAt) : null,
        lastLocation: latestLocation,
    });
}));

// ─── POST /api/v1/tracking/update (legacy REST endpoint) ───────────────────
router.post('/update', async (req, res) => {
    try {
        const { deliveryId, latitude, longitude, heading = 0, speed = 0 } = req.body;
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!deliveryId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ error: 'deliveryId, latitude, and longitude are required' });
        }
        const timestamp   = Date.now();
        const trackingData = { deliveryId, latitude: lat, longitude: lng, heading, speed, timestamp };

        if (redisClient?.isReady) {
            await redisClient.hSet('active_deliveries', String(deliveryId),
                JSON.stringify({ latitude: lat, longitude: lng })).catch(() => {});
            await redisClient.hSet(`delivery_info:${deliveryId}`, 'latest',
                JSON.stringify(trackingData)).catch(() => {});
        }

        try {
            getIo().of('/tracking').to(`delivery_${deliveryId}`).emit('location_update', trackingData);
        } catch { /* ignore */ }

        return res.json({ success: true, data: trackingData });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error', msg: error.message });
    }
});

// ─── POST /api/v1/tracking/equipment-update — live equipment GPS update ───────
// Called by owner/operator's browser (Section 3B: no GPS tracker device).
// Stores in Supabase equipment_tracking table and broadcasts via Realtime channel.
router.post('/equipment-update', auth(true), asyncHandler(async (req, res) => {
    const { equipment_id, lat, lng, timestamp } = req.body;
    const latitude  = Number(lat);
    const longitude = Number(lng);

    if (!equipment_id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ error: 'equipment_id, lat, and lng are required' });
    }

    /* Verify the caller owns this equipment */
    if (supabase) {
        const { data: eq } = await supabase
            .from('equipment').select('owner_id').eq('id', equipment_id).maybeSingle();
        if (!eq || eq.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'Not authorised to update this equipment location' });
        }

        /* Persist to Supabase — Realtime will broadcast to subscribers automatically */
        await supabase.from('equipment_tracking').insert({
            equipment_id,
            lat: latitude,
            lng: longitude,
            timestamp: timestamp || new Date().toISOString(),
        });
    }

    /* Also broadcast via Socket.IO for immediate delivery */
    try {
        getIo().of('/tracking').to(`tracking:${equipment_id}`).emit('equipment:location', {
            equipment_id, lat: latitude, lng: longitude,
            timestamp: timestamp || Date.now(),
        });
    } catch { /* socket not initialised */ }

    return res.json({ success: true });
}));

module.exports = router;
