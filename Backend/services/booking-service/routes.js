const express = require('express');
const router  = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const supabase = require('../../lib/supabase');
const { auth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { bookingCreateSchema } = require('../../validations/schemas');
const { getRouteWithFallback } = require('../routing-service/osrm');
const { emitBookingStatusChange } = require('../tracking-service/socket');
const { redisClient, getHasGeoSupport } = require('../tracking-service/redisClient');
const { sendNotification } = require('../../lib/notificationService');
const emailService = require('../../lib/emailService');

function isUuid(v) {
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Find nearest available driver from a given coordinate using Redis GEOSEARCH.
 * Falls back to DB query if Redis unavailable.
 */
async function findNearestDriver(lat, lng, radiusKm = 100) {
    // 1. Try Redis GEOSEARCH if supported (O(1) search)
    if (redisClient?.isReady && getHasGeoSupport()) {
        try {
            const results = await redisClient.geoSearchWith(
                'drivers:geo',
                { latitude: lat, longitude: lng },
                { radius: radiusKm, unit: 'km' },
                { SORT: 'ASC', COUNT: 1 }
            );
            if (results && results.length > 0) {
                return results[0].member;
            }
        } catch (e) {
            console.warn('[booking] Redis geo search failed:', e.message);
        }
    }

    // 2. Optimized DB Search using RPC (Haversine in SQL)
    if (!supabase) return null;
    try {
        const { data: results, error } = await supabase.rpc('find_nearest_available_drivers', {
            p_lat: lat,
            p_lng: lng,
            p_radius_km: radiusKm,
            p_limit: 1
        });
        if (error) throw error;
        if (results && results.length > 0) {
            return results[0].id;
        }
    } catch (dbErr) {
        console.warn('[booking] DB RPC search failed:', dbErr.message);
        // Final naive fallback
        const { data } = await supabase
            .from('drivers')
            .select('id')
            .eq('is_available', true)
            .not('current_lat', 'is', null)
            .limit(1)
            .maybeSingle();
        return data?.id || null;
    }
    return null;
}

// ─── Health ───────────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.json({ message: 'Booking Service Online' }));

// ─── POST /api/v1/bookings ────────────────────────────────────────────────────
// Create booking → auto-assign nearest driver → emit socket event
router.post('/', auth(true), validate(bookingCreateSchema), asyncHandler(async (req, res) => {
    const {
        equipment_id, machineId,
        start_date, startDate, end_date, endDate,
        total_amount, totalAmount,
        farmer_name, farmerName,
        payment_method, paymentMethod,
        pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
        notes,
    } = req.body || {};

    const eqId  = equipment_id || machineId;
    const start = start_date   || startDate;
    const end   = end_date     || endDate;

    if (!eqId || !start || !end)
        return res.status(400).json({ status: 'error', message: 'equipment_id, start_date and end_date are required' });
    if (!isUuid(String(eqId)))
        return res.status(400).json({ status: 'error', message: 'Invalid equipment_id' });

    const startsAt = new Date(start);
    const endsAt = new Date(end);
    if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
        return res.status(400).json({ status: 'error', message: 'Invalid start_date or end_date format' });
    }

    const renter_id = req.user?.id || null;
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });

    // Get equipment + owner
    const { data: eq, error: eqErr } = await supabase
        .from('equipment')
        .select('owner_id, latitude, longitude')
        .eq('id', eqId)
        .single();
    if (eqErr) return res.status(404).json({ status: 'error', message: 'Equipment not found' });

    // Auto-assign nearest driver
    const pLat = Number(pickup_lat) || eq.latitude;
    const pLng = Number(pickup_lng) || eq.longitude;
    let nearestDriverId = null;
    let distance_km = null;
    let eta_minutes = null;
    let route_geometry = null;

    if (pLat && pLng) {
        try {
            nearestDriverId = await findNearestDriver(pLat, pLng);
            if (nearestDriverId) {
                // Get driver current position for route calculation
                const { data: driverData } = await supabase
                    .from('drivers')
                    .select('current_lat, current_lng')
                    .eq('id', nearestDriverId)
                    .single();

                if (driverData && driverData.current_lat !== null) {
                    try {
                        const route = await getRouteWithFallback(
                            driverData.current_lat, driverData.current_lng,
                            pLat, pLng
                        );
                        if (route) {
                            distance_km    = route.distance_km;
                            eta_minutes    = route.duration_minutes;
                            route_geometry = route.geometry ? JSON.stringify(route.geometry) : null;
                        }
                    } catch (routeErr) {
                        console.warn('[booking] Routing failed:', routeErr.message);
                    }
                }
            }
        } catch (assignErr) {
            console.error('[booking] Assignment failed:', assignErr);
            // We still proceed with the booking even if driver assignment fails (it stays unassigned)
        }
    }

    // Insert booking WITHOUT driver_id first (atomic assignment follows)
    const { data, error } = await supabase
        .from('bookings')
        .insert({
            equipment_id:   eqId,
            renter_id,
            owner_id:       eq?.owner_id || null,
            driver_id:      null,
            farmer_name:    farmer_name || farmerName || 'Farmer',
            start_date:     startsAt.toISOString(),
            end_date:       endsAt.toISOString(),
            total_amount:   Number(total_amount || totalAmount) || 0,
            payment_method: payment_method || paymentMethod || 'razorpay',
            status:         'requested',
            pickup_lat:     pLat || null,
            pickup_lng:     pLng || null,
            dropoff_lat:    Number(dropoff_lat) || null,
            dropoff_lng:    Number(dropoff_lng) || null,
            distance_km,
            eta_minutes,
            route_geometry,
            notes: notes || null,
        })
        .select()
        .single();
    if (error) throw error;

    // Atomically assign driver via Postgres advisory lock RPC (prevents double-booking)
    if (nearestDriverId) {
        try {
            const { data: assigned } = await supabase.rpc('try_assign_driver', {
                p_driver_id:  nearestDriverId,
                p_booking_id: data.id,
            });
            if (!assigned) {
                // Driver was taken — find next available and retry once
                const fallbackDriverId = await findNearestDriver(pLat, pLng).catch(() => null);
                if (fallbackDriverId) {
                    const { data: assigned2 } = await supabase.rpc('try_assign_driver', {
                        p_driver_id:  fallbackDriverId,
                        p_booking_id: data.id,
                    });
                    nearestDriverId = assigned2 ? fallbackDriverId : null;
                } else {
                    nearestDriverId = null;
                }
            }
        } catch (e) {
            console.warn('[booking] Driver assignment RPC failed, booking proceeds unassigned:', e.message);
            nearestDriverId = null;
        }
        // Notify driver via socket
        emitBookingStatusChange(data.id, {
            bookingId: data.id,
            status: 'requested',
            message: 'New booking assigned to you',
            booking: data,
        }, [nearestDriverId]);
    }

    // Notify renter — booking created
    if (renter_id) {
        sendNotification(renter_id, {
            type: 'booking_request',
            title: 'Booking Submitted',
            message: 'Your booking has been submitted and is awaiting confirmation.',
            data: { bookingId: data.id },
        }).catch(() => {});
    }
    // Notify owner — new request
    if (eq?.owner_id) {
        sendNotification(eq.owner_id, {
            type: 'booking_request',
            title: 'New Booking Request',
            message: `A farmer has requested to rent your equipment.`,
            data: { bookingId: data.id },
        }).catch(() => {});
        // Fetch owner email for email notification
        if (supabase) {
            supabase.from('users').select('email,name').eq('id', eq.owner_id).single().then(({ data: owner }) => {
                if (owner) {
                    const farmerName = farmer_name || farmerName || 'A farmer';
                    emailService.sendNewBookingRequestToOwner(owner.email, {
                        ownerName: owner.name,
                        farmerName,
                        equipmentName: eqId,
                        startDate: start,
                        endDate: end,
                        bookingId: data.id,
                    }).catch(() => {});
                }
            }).catch(() => {});
        }
    }

    return res.status(201).json({
        data,
        driverAssigned: !!nearestDriverId,
        eta_minutes,
        distance_km,
    });
}));

// ─── GET /api/v1/bookings/my ──────────────────────────────────────────────────
router.get('/my', asyncHandler(async (req, res) => {
    const renterId = req.user?.id || req.user?.sub;
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });
    if (!renterId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

    const { data, error } = await supabase
        .from('bookings')
        .select(`
            *,
            equipment(name, type, images),
            drivers!bookings_driver_id_fkey(
                id, vehicle_name, vehicle_type, vehicle_number, rating, total_trips,
                users(name, phone)
            )
        `)
        .eq('renter_id', renterId)
        .order('created_at', { ascending: false });
    if (error) {
        // Fallback without driver join if FK not yet in schema cache
        const { data: plain, error: e2 } = await supabase
            .from('bookings')
            .select('*, equipment(name, type, images)')
            .eq('renter_id', renterId)
            .order('created_at', { ascending: false });
        if (e2) throw e2;
        return res.json({ bookings: plain });
    }
    return res.json({ bookings: data });
}));

// ─── GET /api/v1/bookings/driver ──────────────────────────────────────────────
// Get all bookings assigned to the logged-in driver
router.get('/driver', auth(true), asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });

    // Get driver ID
    const { data: driverRow } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', userId)
        .single();
    if (!driverRow) return res.status(404).json({ status: 'error', message: 'Driver profile not found' });

    const { data, error } = await supabase
        .from('bookings')
        .select('*, equipment(name, type, images, location)')
        .eq('driver_id', driverRow.id)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ bookings: data || [] });
}));

// ─── GET /api/v1/bookings/incoming ───────────────────────────────────────────
router.get('/incoming', asyncHandler(async (req, res) => {
    const status  = req.query.status || 'pending';
    const ownerId = req.user?.id || req.user?.sub;
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });
    let q = supabase.from('bookings').select('*, equipment(name,type)').eq('status', status);
    if (ownerId) q = q.eq('owner_id', ownerId);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ bookings: data });
}));

// ─── GET /api/v1/bookings/availability/:equipmentId ──────────────────────────
router.get('/availability/:equipmentId', asyncHandler(async (req, res) => {
    const { equipmentId } = req.params;
    if (!isUuid(String(equipmentId))) return res.status(404).json({ data: [], equipmentId });
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });
    const { data, error } = await supabase
        .from('bookings')
        .select('start_date,end_date,status')
        .eq('equipment_id', equipmentId)
        .neq('status', 'cancelled');
    if (error) throw error;
    return res.json({ data: (data || []).map(b => ({ start_date: b.start_date, end_date: b.end_date, status: b.status })), equipmentId });
}));

// ─── GET /api/v1/bookings/:id ─────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });
    const { data, error } = await supabase
        .from('bookings')
        .select('*, equipment(*), drivers(*, users(name,phone,email))')
        .eq('id', req.params.id)
        .single();
    if (error || !data) return res.status(404).json({ status: 'error', message: 'Booking not found' });
    return res.json({ data });
}));

// ─── Lifecycle transitions ─────────────────────────────────────────────────────
async function transitionBooking(bookingId, newStatus, extraFields = {}, userIds = []) {
    if (!supabase) throw new Error('Database not configured');
    const { data, error } = await supabase
        .from('bookings')
        .update({ status: newStatus, ...extraFields })
        .eq('id', bookingId)
        .select()
        .single();
    if (error) throw error;
    emitBookingStatusChange(bookingId, { bookingId, status: newStatus, booking: data }, userIds);
    return data;
}

// ─── PATCH /api/v1/bookings/:id/accept ─── Driver accepts
router.patch('/:id/accept', auth(true), asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });
    const { data: existing } = await supabase.from('bookings').select('renter_id').eq('id', req.params.id).single();
    const booking = await transitionBooking(req.params.id, 'accepted', { accepted_at: new Date().toISOString() }, [existing?.renter_id].filter(Boolean));
    if (existing?.renter_id) {
        sendNotification(existing.renter_id, {
            type: 'booking_confirmed',
            title: 'Booking Confirmed!',
            message: 'Your booking has been accepted. The equipment is on its way.',
            data: { bookingId: req.params.id },
        }).catch(() => {});
    }
    return res.json({ data: booking });
}));

// ─── PATCH /api/v1/bookings/:id/start ─── Driver starts trip
router.patch('/:id/start', auth(true), asyncHandler(async (req, res) => {
    const booking = await transitionBooking(req.params.id, 'in_progress', { started_at: new Date().toISOString() });
    return res.json({ data: booking });
}));

// ─── PATCH /api/v1/bookings/:id/complete ── Driver completes trip
router.patch('/:id/complete', auth(true), asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });

    // Get driver_id so we can free them up
    const { data: existing } = await supabase
        .from('bookings')
        .select('driver_id, renter_id')
        .eq('id', req.params.id)
        .single();

    const booking = await transitionBooking(
        req.params.id, 'completed',
        { completed_at: new Date().toISOString() },
        [existing?.renter_id].filter(Boolean)
    );

        // Notify renter — booking completed
    if (existing?.renter_id) {
        sendNotification(existing.renter_id, {
            type: 'booking_confirmed',
            title: 'Booking Completed',
            message: 'Your rental has been completed. Please leave a review!',
            data: { bookingId: req.params.id },
        }).catch(() => {});
    }

    // Free up driver & increment trip count
        if (existing?.driver_id) {
            try {
                await supabase.from('drivers')
                    .update({ is_available: true })
                    .eq('id', existing.driver_id);
            } catch { /* driver availability update is best-effort */ }

            // Atomic increment via RPC
            try {
                await supabase.rpc('drivers_increment_trips', { 
                    driver_id: existing.driver_id 
                });
            } catch (err) {
                console.warn('[booking] Failed to increment driver trips:', err.message);
            }
        }

    return res.json({ data: booking });
}));

// ─── PATCH /api/v1/bookings/:id/cancel ────────────────────────────────────────
router.patch('/:id/cancel', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });
    const { data: existing } = await supabase
        .from('bookings')
        .select('driver_id, renter_id, owner_id')
        .eq('id', req.params.id)
        .single();

    const booking = await transitionBooking(
        req.params.id, 'cancelled', {},
        [existing?.renter_id, existing?.owner_id].filter(Boolean)
    );

    // Notify both parties
    const notifPayload = { type: 'booking_cancelled', title: 'Booking Cancelled', message: 'A booking has been cancelled.', data: { bookingId: req.params.id } };
    if (existing?.renter_id) sendNotification(existing.renter_id, notifPayload).catch(() => {});
    if (existing?.owner_id)  sendNotification(existing.owner_id,  notifPayload).catch(() => {});

    // Free up driver
    if (existing?.driver_id) {
        try {
            await supabase.from('drivers').update({ is_available: true }).eq('id', existing.driver_id);
        } catch { /* driver availability update is best-effort */ }
    }

    return res.json({ data: booking });
}));

// ─── PATCH /api/v1/bookings/:id/reject (alias for cancel from owner side) ─────
router.patch('/:id/reject', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not configured' });
    const { data, error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', req.params.id)
        .eq('status', 'requested')
        .select()
        .single();
    if (error) throw error;
    return res.json({ data });
}));

// ─── POST /api/v1/bookings/promo/validate ─────────────────────────────────────
// Simple promo code validation — codes stored in a promo_codes table or hardcoded
router.post('/promo/validate', auth(true), asyncHandler(async (req, res) => {
    const { code, amount } = req.body ?? {};
    if (!code) return res.status(400).json({ status: 'error', message: 'Promo code is required' });

    const upperCode = String(code).trim().toUpperCase();

    // Try Supabase promo_codes table first
    if (supabase) {
        const { data: promo } = await supabase
            .from('promo_codes')
            .select('*')
            .eq('code', upperCode)
            .eq('is_active', true)
            .maybeSingle();

        if (promo) {
            const now = new Date();
            if (promo.expires_at && new Date(promo.expires_at) < now) {
                return res.status(400).json({ status: 'error', message: 'This promo code has expired' });
            }
            if (promo.min_amount && (amount ?? 0) < promo.min_amount) {
                return res.status(400).json({ status: 'error', message: `Minimum rental of ₹${promo.min_amount} required for this code` });
            }
            const discount = promo.discount_type === 'percent'
                ? Math.round((amount ?? 0) * promo.discount_value / 100)
                : promo.discount_value;
            const cappedDiscount = promo.max_discount ? Math.min(discount, promo.max_discount) : discount;
            return res.json({ success: true, discount: cappedDiscount, label: promo.label || `${upperCode} applied` });
        }
    }

    // Fallback: well-known demo codes (remove in production)
    const DEMO_CODES = {
        FARM100:   { discount: 100,  label: '₹100 off on your booking!' },
        KISAN200:  { discount: 200,  label: 'Kisan Special — ₹200 off!' },
        FIRST50:   { discount: 50,   label: '₹50 off for first-time bookers' },
        HARVEST10: { discount: Math.round((amount ?? 0) * 0.10), label: '10% off your rental cost!' },
    };

    const demo = DEMO_CODES[upperCode];
    if (demo) return res.json({ success: true, ...demo });

    return res.status(404).json({ status: 'error', message: 'Invalid or expired promo code' });
}));

module.exports = router;
