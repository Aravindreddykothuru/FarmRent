/**
 * driver-service/routes.js
 * Driver profile management, availability toggling, nearest-driver lookup, and trip controls.
 * Uses Redis GEOADD/GEOSEARCH for spatial queries.
 */
const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const { auth } = require('../../middleware/auth');
const supabase = require('../../lib/supabase');
const { redisClient } = require('../tracking-service/redisClient');
const { validateGPS } = require('../../lib/gpsValidator');
const { emitBookingStatusChange } = require('../tracking-service/socket');

const DRIVERS_GEO_KEY = 'drivers:geo';

// ─── POST /api/v1/drivers/register ────────────────────────────────────────────
// Register current user as a driver with vehicle info
router.post('/register', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { vehicle_name, vehicle_type, vehicle_number, license_number } = req.body;
    if (!vehicle_name || !vehicle_type || !vehicle_number)
        return res.status(400).json({ error: 'vehicle_name, vehicle_type, vehicle_number are required' });

    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    // Update user role to driver
    const { error: roleErr } = await supabase
        .from('users')
        .update({ role: 'driver' })
        .eq('id', userId);
    if (roleErr) throw roleErr;

    // Upsert driver profile
    const { data, error } = await supabase
        .from('drivers')
        .upsert({ user_id: userId, vehicle_name, vehicle_type, vehicle_number, license_number })
        .select()
        .single();
    if (error) throw error;

    return res.status(201).json({ success: true, data });
}));

// ─── GET /api/v1/drivers/me ────────────────────────────────────────────────────
router.get('/me', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data, error } = await supabase
        .from('drivers')
        .select('id, user_id, vehicle_name, vehicle_type, vehicle_number, is_available, current_lat, current_lng, heading, speed, rating, total_trips, created_at, updated_at, users(name, email, phone)')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Driver profile not found. Please register first.' });

    return res.json({ success: true, data });
}));

// ─── PATCH /api/v1/drivers/availability ───────────────────────────────────────
// Toggle driver online/offline status
router.patch('/availability', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { is_available } = req.body;
    if (typeof is_available !== 'boolean')
        return res.status(400).json({ error: 'is_available (boolean) required' });

    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data, error } = await supabase
        .from('drivers')
        .update({ is_available })
        .eq('user_id', userId)
        .select()
        .single();
    if (error) throw error;

    // If going offline, remove from Redis geo index
    if (!is_available && redisClient?.isReady) {
        await redisClient.zRem(DRIVERS_GEO_KEY, String(data.id)).catch(() => {});
    }

    return res.json({ success: true, data });
}));

// ─── PATCH /api/v1/drivers/location ───────────────────────────────────────────
// Update driver GPS position — REST fallback (primary channel is WebSocket)
router.patch('/location', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { latitude, longitude, heading = 0, speed = 0, accuracy = 10 } = req.body;
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return res.status(400).json({ error: 'Valid latitude and longitude required' });

    // GPS validation
    const { valid, reason, flags } = validateGPS({ lat, lng, accuracy, speed, timestamp: Date.now() });
    if (!valid) return res.status(422).json({ error: 'GPS validation failed', reason, flags });

    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data, error } = await supabase
        .from('drivers')
        .update({ current_lat: lat, current_lng: lng, heading, speed })
        .eq('user_id', userId)
        .select('id')
        .single();
    if (error) throw error;

    if (redisClient?.isReady && data?.id) {
        await redisClient.geoAdd(DRIVERS_GEO_KEY, {
            longitude: lng, latitude: lat, member: String(data.id),
        }).catch(() => {});
    }

    return res.json({ success: true, lat, lng, flags });
}));

// ─── POST /api/v1/drivers/trip/start ──────────────────────────────────────────
// Driver starts trip for a booking (transitions booking → in_progress)
router.post('/trip/start', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    // Verify this driver owns the booking
    const { data: driver } = await supabase
        .from('drivers').select('id').eq('user_id', userId).single();
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const { data: booking, error } = await supabase
        .from('bookings')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', booking_id)
        .eq('driver_id', driver.id)
        .select()
        .single();
    if (error) throw error;
    if (!booking) return res.status(404).json({ error: 'Booking not found or not assigned to you' });

    // Notify farmer via socket
    try {
        emitBookingStatusChange(booking_id, {
            bookingId: booking_id, status: 'in_progress',
            message: 'Driver has started the trip!', booking,
        }, [booking.renter_id].filter(Boolean));
    } catch { /* non-critical */ }

    return res.json({ success: true, data: booking });
}));

// ─── POST /api/v1/drivers/trip/end ────────────────────────────────────────────
// Driver ends trip (transitions booking → completed)
router.post('/trip/end', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data: driver } = await supabase
        .from('drivers').select('id').eq('user_id', userId).single();
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const { data: booking, error } = await supabase
        .from('bookings')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', booking_id)
        .eq('driver_id', driver.id)
        .select()
        .single();
    if (error) throw error;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Free driver & increment trips
    await supabase.from('drivers').update({ is_available: true }).eq('id', driver.id);
    await supabase.rpc('drivers_increment_trips', { driver_id: driver.id });
    if (redisClient?.isReady) {
        await redisClient.zRem(DRIVERS_GEO_KEY, String(driver.id)).catch(() => {});
    }

    try {
        emitBookingStatusChange(booking_id, {
            bookingId: booking_id, status: 'completed',
            message: 'Trip completed!', booking,
        }, [booking.renter_id].filter(Boolean));
    } catch { /* non-critical */ }

    return res.json({ success: true, data: booking });
}));

// ─── PATCH /api/v1/drivers/share-location ─────────────────────────────────────
// Toggle driver's live location sharing on/off
router.patch('/share-location', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { sharing } = req.body; // boolean
    if (typeof sharing !== 'boolean') return res.status(400).json({ error: 'sharing (boolean) required' });
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const { data, error } = await supabase
        .from('drivers')
        .update({ location_sharing: sharing })
        .eq('user_id', userId)
        .select('id, location_sharing')
        .single();
    if (error) throw error;

    // Remove from geo index when sharing is off
    if (!sharing && redisClient?.isReady && data?.id) {
        await redisClient.zRem(DRIVERS_GEO_KEY, String(data.id)).catch(() => {});
    }

    return res.json({ success: true, data });
}));

// ─── GET /api/v1/drivers/nearby ────────────────────────────────────────────────
// Find nearest available drivers using Redis GEOSEARCH
// ?lat=17.38&lng=78.48&radius=50 (km)
router.get('/nearby', asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius) || 50;

    if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return res.status(400).json({ error: 'lat and lng are required' });

    let driverIds = [];

    // Try Redis GEOSEARCH first
    if (redisClient?.isReady) {
        try {
            const results = await redisClient.geoSearchWith(
                DRIVERS_GEO_KEY,
                { latitude: lat, longitude: lng },
                { radius, unit: 'km' },
                { SORT: 'ASC', COUNT: 20, WITHDIST: true, WITHCOORD: true }
            );
            driverIds = results.map(r => r.member);
        } catch (e) {
            console.warn('[drivers/nearby] Redis geo search failed:', e.message);
        }
    }

    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    // Fetch from DB — filter to available drivers, join user info
    let query = supabase
        .from('drivers')
        .select('id, user_id, vehicle_name, vehicle_type, vehicle_number, is_available, current_lat, current_lng, heading, speed, rating, total_trips, users(name, phone)')
        .eq('is_available', true)
        .not('current_lat', 'is', null);

    // If we have Redis results, filter to those (already sorted by distance)
    if (driverIds.length > 0) {
        query = query.in('id', driverIds);
    }

    const { data, error } = await query.limit(10);
    if (error) throw error;

    return res.json({ success: true, data: data || [] });
}));

// ─── GET /api/v1/drivers/:id ────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    const { data, error } = await supabase
        .from('drivers')
        .select('id, user_id, vehicle_name, vehicle_type, vehicle_number, is_available, current_lat, current_lng, rating, total_trips, users(name, phone)')
        .eq('id', req.params.id)
        .single();
    if (error || !data) return res.status(404).json({ error: 'Driver not found' });
    return res.json({ success: true, data });
}));

// ─── GET /api/v1/drivers ────────────────────────────────────────────────────
// List all drivers (admin view)
router.get('/', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    const { data, error } = await supabase
        .from('drivers')
        .select('id, user_id, vehicle_name, vehicle_type, vehicle_number, is_available, current_lat, current_lng, rating, total_trips, created_at, users(name, email)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, data: data || [] });
}));

module.exports = router;
