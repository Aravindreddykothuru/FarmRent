/**
 * Booking service — /api/v1/bookings
 *
 * - Every booking is priced on the server (pricing.js); client-sent amounts are ignored.
 * - Double-booking is rejected by the equipment_rentals_no_overlap exclusion constraint, with a
 *   pre-check that gives the common case a clear message.
 * - Every status change goes through lifecycle.js (who may do it, from which state) and is applied
 *   conditionally on the current status, so concurrent requests cannot skip or repeat a transition.
 */
'use strict';

const express = require('express');
const router = express.Router();

const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');
const emailService = require('../../lib/emailService');
const { getJwtSecret } = require('../../lib/jwtSecret');
const { sendNotification } = require('../../lib/notificationService');
const { asyncHandler } = require('../../middleware/asyncHandler');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/requireRole');
const { validate } = require('../../middleware/validate');
const { bookingLimiter, createRateLimiter } = require('../../middleware/redisRateLimiter');
const schemas = require('../../validations/schemas');
const { getRouteWithFallback } = require('../routing-service/osrm');
const { emitBookingStatusChange } = require('../tracking-service/socket');
const { redisClient, getHasGeoSupport } = require('../tracking-service/redisClient');
const { refundBookingPayment } = require('../payment-service/refunds');
const lifecycle = require('./lifecycle');
const pricing = require('./pricing');

const { BookingError, LIVE_STATUSES, toClientStatus, toDbStatus } = lifecycle;

const EXCLUSION_VIOLATION = '23P01';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Contact details and the exact pickup point are shared only once the owner has accepted.
const REVEAL_CONTACT_STATUSES = new Set(['approved', 'active', 'return_pending', 'completed']);
const AVAILABILITY_TTL_SEC = 600;

const completionLimiter = createRateLimiter({
    name: 'booking-completion',
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many completion attempts. Please wait before trying again.',
});

const PARTY_SELECT = 'renter:users!renter_id(id, full_name, phone, email), owner:users!owner_id(id, full_name, phone, email)';
const LIST_SELECT = `*, equipment(id, name, category, images, district, state), ${PARTY_SELECT}`;
const DETAIL_SELECT = `*, equipment(id, name, category, images, daily_rate, district, state, address_full, pickup_lat, pickup_lng, pickup_address, pickup_landmark), ${PARTY_SELECT}, drivers(id, user_id, name, phone, vehicle_name, vehicle_type, vehicle_number, rating, total_trips)`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function db() {
    if (!supabase) throw new BookingError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

const money = (value) => (value == null ? null : Number(value));

const conflictError = () =>
    new BookingError(
        409,
        'BOOKING_CONFLICT',
        'This equipment is already booked for some of the selected dates. Please choose different dates.',
    );

function party(user, reveal) {
    if (!user) return null;
    return { id: user.id, name: user.full_name, ...(reveal ? { phone: user.phone || null, email: user.email || null } : {}) };
}

/** Client shape: stored snake_case fields plus the camelCase aliases the web pages read. */
function toClientBooking(row, { reveal = false } = {}) {
    if (!row) return null;
    const { equipment, renter, owner, drivers, ...booking } = row;
    const showContact = reveal && REVEAL_CONTACT_STATUSES.has(row.status);
    const dailyRate = money(row.daily_rate);
    const totalAmount = money(row.total_amount);
    const serviceFee = money(row.service_fee) ?? 0;

    let equipmentOut = null;
    let machine = null;
    let pickup = null;
    if (equipment) {
        const { pickup_lat, pickup_lng, pickup_address, pickup_landmark, ...publicEquipment } = equipment;
        equipmentOut = { ...publicEquipment, type: equipment.category };
        if ('daily_rate' in equipment) equipmentOut.daily_rate = money(equipment.daily_rate);
        machine = {
            id: equipment.id,
            _id: equipment.id,
            name: equipment.name,
            type: equipment.category,
            images: equipment.images || [],
            location: { district: equipment.district || '', state: equipment.state || '' },
        };
        if (showContact && pickup_lat != null && pickup_lng != null) {
            pickup = { lat: pickup_lat, lng: pickup_lng, address: pickup_address || '', landmark: pickup_landmark || null };
        }
    }

    return {
        ...booking,
        _id: row.id,
        status: toClientStatus(row.status),
        daily_rate: dailyRate,
        price_per_day: dailyRate,
        subtotal: dailyRate != null && row.total_days != null ? Math.round(dailyRate * row.total_days * 100) / 100 : null,
        service_fee: serviceFee,
        deposit_amount: money(row.deposit_amount) ?? 0,
        delivery_charge: money(row.delivery_charge) ?? 0,
        discount_amount: money(row.discount_amount) ?? 0,
        total_amount: totalAmount,
        distance_km: money(row.distance_km),
        machineId: row.equipment_id,
        startDate: row.start_date,
        endDate: row.end_date,
        totalDays: row.total_days,
        totalAmount,
        serviceFee,
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        farmerName: renter?.full_name || null,
        equipment: equipmentOut,
        machine,
        renter: party(renter, showContact),
        owner: party(owner, showContact),
        drivers: showContact ? drivers || null : null,
        pickup,
    };
}

function notify(userId, payload) {
    if (!userId) return;
    sendNotification(userId, payload).catch((err) =>
        logger.warn('[booking] notification enqueue failed', { userId, type: payload.type, error: err.message }),
    );
}

function invalidateAvailability(equipmentId) {
    if (!equipmentId || !redisClient?.isReady) return;
    redisClient
        .del(`booking:avail:${equipmentId}`)
        .catch((err) => logger.warn('[booking] availability cache invalidation failed', { equipmentId, error: err.message }));
}

async function driverIdFor(userId) {
    const { data, error } = await db().from('drivers').select('id').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.id || null;
}

/** Loads a booking and the caller's relationship to it. Unrelated callers get 404 so ids cannot be probed. */
async function loadBookingFor(req, select = DETAIL_SELECT) {
    const { id } = req.params;
    if (!UUID_RE.test(id)) throw new BookingError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const { data: booking, error } = await db().from('equipment_rentals').select(select).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!booking) throw new BookingError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const driverId = booking.driver_id ? await driverIdFor(req.user.id) : null;
    const relations = lifecycle.relationsTo(booking, req.user, driverId);
    if (relations.size === 0) throw new BookingError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    return { booking, relations };
}

/** Live booking of `equipmentId` that shares at least one day with [startDate, endDate]. */
async function findConflict(equipmentId, startDate, endDate, excludeBookingId = null) {
    let query = db()
        .from('equipment_rentals')
        .select('id, start_date, end_date, status')
        .eq('equipment_id', equipmentId)
        .in('status', LIVE_STATUSES)
        .lte('start_date', endDate)
        .gte('end_date', startDate)
        .limit(1);
    if (excludeBookingId) query = query.neq('id', excludeBookingId);
    const { data, error } = await query;
    if (error) throw error;
    return data?.[0] || null;
}

async function loadPromo(code) {
    const { data, error } = await db().from('promo_codes').select('*').eq('code', code).maybeSingle();
    if (error) throw error;
    return data;
}

/** Loads the listing and prices the requested rental exactly as a booking would be priced. */
async function quoteFor(input, renterId = null) {
    const { data: equipment, error } = await db()
        .from('equipment')
        .select(
            'id, owner_id, name, daily_rate, deposit_amount, status, is_verified, is_deleted, latitude, longitude, pickup_lat, pickup_lng',
        )
        .eq('id', input.equipment_id)
        .maybeSingle();
    if (error) throw error;
    if (!equipment || equipment.is_deleted) throw new BookingError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');
    if (equipment.status !== 'active' || !equipment.is_verified) {
        throw new BookingError(409, 'EQUIPMENT_UNAVAILABLE', 'This equipment is not available for rent right now');
    }
    if (renterId && equipment.owner_id === renterId) {
        throw new BookingError(400, 'OWN_EQUIPMENT', 'You cannot rent your own equipment');
    }

    const promo = input.promo_code ? await loadPromo(input.promo_code) : null;
    if (input.promo_code && !promo) throw new BookingError(404, 'PROMO_INVALID', 'Invalid or expired promo code');

    const quote = pricing.quoteRental({
        dailyRate: equipment.daily_rate,
        startDate: input.start_date,
        endDate: input.end_date,
        deposit: equipment.deposit_amount,
        deliveryMode: input.delivery_mode,
        promo,
    });
    return { equipment, promo, quote };
}

function recordPromoRedemption(code, bookingId) {
    db()
        .rpc('redeem_promo_code', { p_code: code })
        .then(
            ({ data, error }) => {
                if (error || data !== true) {
                    logger.warn('[booking] promo redemption not recorded', { code, bookingId, error: error?.message, redeemed: data });
                }
            },
            (err) => logger.warn('[booking] promo redemption request failed', { code, bookingId, error: err.message }),
        );
}

async function releaseDriver(driverId, { completedTrip = false } = {}) {
    if (!driverId) return;
    const { error } = await db().from('drivers').update({ is_available: true }).eq('id', driverId);
    if (error) logger.warn('[booking] failed to release driver', { driverId, error: error.message });
    if (completedTrip) {
        const { error: rpcError } = await db().rpc('drivers_increment_trips', { driver_id: driverId });
        if (rpcError) logger.warn('[booking] failed to increment driver trips', { driverId, error: rpcError.message });
    }
}

async function nearestDriverIds(lat, lng, limit = 3) {
    if (redisClient?.isReady && getHasGeoSupport()) {
        try {
            const ids = await redisClient.geoSearch(
                'drivers:geo',
                { latitude: lat, longitude: lng },
                { radius: 100, unit: 'km' },
                { SORT: 'ASC', COUNT: limit },
            );
            if (ids.length > 0) return ids;
        } catch (err) {
            logger.warn('[booking] Redis driver geo search failed, using database', { error: err.message });
        }
    }
    const { data, error } = await db().rpc('find_nearest_available_drivers', { p_lat: lat, p_lng: lng, p_radius_km: 100, p_limit: limit });
    if (error) throw error;
    return (data || []).map((d) => d.id);
}

/** Best-effort: attach the nearest free driver to a new booking. The booking stands either way. */
async function assignNearestDriver(booking, lat, lng) {
    if (lat == null || lng == null) return;
    for (const driverId of await nearestDriverIds(lat, lng)) {
        const { data: assigned, error } = await db().rpc('try_assign_driver', { p_driver_id: driverId, p_booking_id: booking.id });
        if (error) throw error;
        if (!assigned) continue;

        const { data: driver, error: driverError } = await db()
            .from('drivers')
            .select('user_id, current_lat, current_lng')
            .eq('id', driverId)
            .maybeSingle();
        if (driverError) throw driverError;
        if (driver?.current_lat != null) {
            const route = await getRouteWithFallback(driver.current_lat, driver.current_lng, lat, lng);
            if (route) {
                const { error: routeError } = await db()
                    .from('equipment_rentals')
                    .update({
                        distance_km: route.distance_km,
                        eta_minutes: route.duration_minutes,
                        route_geometry: route.geometry ? JSON.stringify(route.geometry) : null,
                    })
                    .eq('id', booking.id);
                if (routeError) logger.warn('[booking] failed to store route', { bookingId: booking.id, error: routeError.message });
            }
        }
        notify(driver?.user_id, {
            type: 'booking_request',
            title: 'New Trip Assigned',
            message: 'A new rental has been assigned to you.',
            data: { bookingId: booking.id },
        });
        return;
    }
}

/**
 * Validates and applies a lifecycle action. The update is conditioned on the status that was
 * authorised, so if another request changed the booking in between, nothing is written.
 */
async function applyTransition(req, action, { changes = {}, verify } = {}) {
    const { booking, relations } = await loadBookingFor(req);
    const rule = lifecycle.assertTransition(action, booking, relations);
    if (verify) verify(booking, relations);

    const { data: updated, error } = await db()
        .from('equipment_rentals')
        .update({ status: rule.to, [rule.timestamp]: new Date().toISOString(), ...changes })
        .eq('id', booking.id)
        .eq('status', booking.status)
        .select(DETAIL_SELECT)
        .maybeSingle();
    if (error) throw error;
    if (!updated) {
        throw new BookingError(409, 'BOOKING_CHANGED', 'This booking was just updated by someone else. Refresh and try again.');
    }

    invalidateAvailability(updated.equipment_id);
    const client = toClientBooking(updated, { reveal: true });
    emitBookingStatusChange(
        updated.id,
        { bookingId: updated.id, id: updated.id, status: client.status, booking: client },
        [updated.renter_id, updated.owner_id].filter(Boolean),
    );
    return { before: booking, updated, client, relations };
}

const equipmentName = (booking) => booking.equipment?.name || 'the equipment';

async function listBookings(column, value, req, res) {
    const { status, limit, offset } = req.query;
    let query = db()
        .from('equipment_rentals')
        .select(LIST_SELECT, { count: 'exact' })
        .eq(column, value)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (status && status !== 'all') query = query.eq('status', toDbStatus(status));
    const { data, error, count } = await query;
    if (error) throw error;
    return res.json({
        bookings: (data || []).map((row) => toClientBooking(row, { reveal: true })),
        total: count ?? 0,
        limit,
        offset,
    });
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

// Public fee settings so the booking page can explain charges before dates are chosen.
router.get('/pricing', (req, res) => {
    res.json({
        serviceFeePercent: pricing.SERVICE_FEE_RATE * 100,
        deliveryCharge: pricing.DELIVERY_CHARGE,
        maxRentalDays: pricing.MAX_RENTAL_DAYS,
    });
});

// Public: the exact price a booking for these inputs would be created with, and whether the dates are free.
router.get(
    '/quote',
    validate(schemas.bookingQuoteSchema, 'query'),
    asyncHandler(async (req, res) => {
        const { equipment, promo, quote } = await quoteFor(req.query, req.user?.id);
        const conflict = await findConflict(equipment.id, req.query.start_date, req.query.end_date);
        return res.json({
            data: {
                ...quote,
                equipmentId: equipment.id,
                promoCode: promo?.code ?? null,
                promoLabel: promo ? promo.label || `${promo.code} applied` : null,
                available: !conflict,
            },
        });
    }),
);

// ─── Create ──────────────────────────────────────────────────────────────────

router.post(
    '/',
    auth(true),
    requireRole('farmer', 'buyer', 'admin'),
    bookingLimiter,
    validate(schemas.bookingCreateSchema),
    asyncHandler(async (req, res) => {
        const input = req.body;
        const { equipment, promo, quote } = await quoteFor(input, req.user.id);

        if (await findConflict(equipment.id, input.start_date, input.end_date)) throw conflictError();

        const pickupLat = input.pickup_lat ?? equipment.pickup_lat ?? equipment.latitude;
        const pickupLng = input.pickup_lng ?? equipment.pickup_lng ?? equipment.longitude;

        const { data: created, error } = await db()
            .from('equipment_rentals')
            .insert({
                equipment_id: equipment.id,
                renter_id: req.user.id,
                owner_id: equipment.owner_id,
                status: 'requested',
                start_date: input.start_date,
                end_date: input.end_date,
                daily_rate: quote.dailyRate,
                service_fee: quote.serviceFee,
                deposit_amount: quote.deposit,
                delivery_charge: quote.deliveryCharge,
                discount_amount: quote.discount,
                total_amount: quote.total,
                promo_code: promo?.code ?? null,
                payment_method: input.payment_method,
                payment_status: 'pending',
                delivery_mode: input.delivery_mode,
                field_address: input.delivery_mode === 'delivery' ? input.field_address : null,
                notes: input.notes,
                pickup_lat: pickupLat ?? null,
                pickup_lng: pickupLng ?? null,
                dropoff_lat: input.dropoff_lat,
                dropoff_lng: input.dropoff_lng,
            })
            .select(DETAIL_SELECT)
            .single();
        // The pre-check can race with a concurrent request; the constraint is the final word.
        if (error?.code === EXCLUSION_VIOLATION) throw conflictError();
        if (error) throw error;

        if (promo) recordPromoRedemption(promo.code, created.id);
        invalidateAvailability(equipment.id);

        notify(req.user.id, {
            type: 'booking_request',
            title: 'Booking Submitted',
            message: `Your request for ${equipment.name} is waiting for the owner's confirmation.`,
            data: { bookingId: created.id },
        });
        notify(equipment.owner_id, {
            type: 'booking_request',
            title: 'New Booking Request',
            message: `${created.renter?.full_name || 'A farmer'} wants to rent ${equipment.name} from ${created.start_date} to ${created.end_date}.`,
            data: { bookingId: created.id },
        });
        if (created.owner?.email) {
            emailService
                .sendNewBookingRequestToOwner(created.owner.email, {
                    ownerName: created.owner.full_name,
                    farmerName: created.renter?.full_name || 'A farmer',
                    equipmentName: equipment.name,
                    startDate: created.start_date,
                    endDate: created.end_date,
                    bookingId: created.id,
                })
                .catch((err) => logger.warn('[booking] owner email failed', { bookingId: created.id, error: err.message }));
        }

        assignNearestDriver(created, pickupLat, pickupLng).catch((err) =>
            logger.warn('[booking] driver assignment failed', { bookingId: created.id, error: err.message }),
        );

        return res.status(201).json({ data: toClientBooking(created, { reveal: true }) });
    }),
);

// ─── Read ────────────────────────────────────────────────────────────────────

// Renter history
router.get(
    '/',
    auth(true),
    validate(schemas.bookingListQuerySchema, 'query'),
    asyncHandler((req, res) => listBookings('renter_id', req.user.id, req, res)),
);
router.get(
    '/my',
    auth(true),
    validate(schemas.bookingListQuerySchema, 'query'),
    asyncHandler((req, res) => listBookings('renter_id', req.user.id, req, res)),
);

// Owner history (requests for the caller's equipment)
router.get(
    '/incoming',
    auth(true),
    validate(schemas.bookingListQuerySchema, 'query'),
    asyncHandler((req, res) => listBookings('owner_id', req.user.id, req, res)),
);

// Trips assigned to the caller's driver profile
router.get(
    '/driver',
    auth(true),
    validate(schemas.bookingListQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        const driverId = await driverIdFor(req.user.id);
        // Users without a driver profile simply have no assigned trips.
        if (!driverId) return res.json({ bookings: [], total: 0, limit: req.query.limit, offset: req.query.offset });
        return listBookings('driver_id', driverId, req, res);
    }),
);

// Public: date ranges already held for a machine (no renter details)
router.get(
    '/availability/:equipmentId',
    asyncHandler(async (req, res) => {
        const { equipmentId } = req.params;
        if (!UUID_RE.test(equipmentId)) throw new BookingError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');

        const cacheKey = `booking:avail:${equipmentId}`;
        if (redisClient?.isReady) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) return res.json({ data: JSON.parse(cached), equipmentId, source: 'redis' });
            } catch (err) {
                logger.warn('[booking] availability cache read failed', { equipmentId, error: err.message });
            }
        }

        const { data, error } = await db()
            .from('equipment_rentals')
            .select('start_date, end_date, status')
            .eq('equipment_id', equipmentId)
            .in('status', LIVE_STATUSES)
            .gte('end_date', pricing.todayIso())
            .order('start_date', { ascending: true });
        if (error) throw error;

        const ranges = (data || []).map((b) => ({ start_date: b.start_date, end_date: b.end_date, status: toClientStatus(b.status) }));
        if (redisClient?.isReady) {
            redisClient
                .setEx(cacheKey, AVAILABILITY_TTL_SEC, JSON.stringify(ranges))
                .catch((err) => logger.warn('[booking] availability cache write failed', { equipmentId, error: err.message }));
        }
        return res.json({ data: ranges, equipmentId, source: 'db' });
    }),
);

// ─── Promo codes ─────────────────────────────────────────────────────────────

router.post(
    '/promo/validate',
    auth(true),
    validate(schemas.promoValidateSchema),
    asyncHandler(async (req, res) => {
        const promo = await loadPromo(req.body.code);
        const discount = pricing.promoDiscount(promo, req.body.amount);
        return res.json({ success: true, code: promo.code, discount, label: promo.label || `${promo.code} applied` });
    }),
);

router.get(
    '/:id',
    auth(true),
    asyncHandler(async (req, res) => {
        const { booking } = await loadBookingFor(req);
        return res.json({ data: toClientBooking(booking, { reveal: true }) });
    }),
);

// Renter-only: code to hand to the owner when returning the equipment
router.get(
    '/:id/completion-otp',
    auth(true),
    asyncHandler(async (req, res) => {
        const { booking, relations } = await loadBookingFor(req);
        if (!relations.has('renter')) throw new BookingError(403, 'FORBIDDEN', 'Only the renter can view the completion code');
        if (!['active', 'return_pending'].includes(booking.status)) {
            throw new BookingError(409, 'INVALID_TRANSITION', 'The completion code is available once the equipment has been handed over');
        }
        return res.json({ otp: lifecycle.completionOtp(booking, getJwtSecret()) });
    }),
);

// ─── Lifecycle transitions ───────────────────────────────────────────────────

router.patch(
    '/:id/accept',
    auth(true),
    asyncHandler(async (req, res) => {
        const { updated, client } = await applyTransition(req, 'accept');
        notify(updated.renter_id, {
            type: 'booking_confirmed',
            title: 'Booking Confirmed',
            message: `The owner confirmed your booking for ${equipmentName(updated)}.`,
            data: { bookingId: updated.id },
        });
        return res.json({ data: client });
    }),
);

router.patch(
    '/:id/reject',
    auth(true),
    validate(schemas.bookingCancelSchema),
    asyncHandler(async (req, res) => {
        const { updated, client } = await applyTransition(req, 'reject', {
            changes: { cancellation_reason: req.body.reason ?? null },
        });
        client.refund = await refundBookingPayment(updated, 'Booking request declined by owner');
        notify(updated.renter_id, {
            type: 'booking_cancelled',
            title: 'Booking Declined',
            message: `The owner could not accept your request for ${equipmentName(updated)}.`,
            data: { bookingId: updated.id },
        });
        return res.json({ data: client });
    }),
);

router.patch(
    '/:id/cancel',
    auth(true),
    validate(schemas.bookingCancelSchema),
    asyncHandler(async (req, res) => {
        const { updated, client, relations } = await applyTransition(req, 'cancel', {
            changes: { cancellation_reason: req.body.reason ?? null },
        });
        client.refund = await refundBookingPayment(updated, req.body.reason || 'Booking cancelled');
        await releaseDriver(updated.driver_id);
        const payload = {
            type: 'booking_cancelled',
            title: 'Booking Cancelled',
            message: `The booking for ${equipmentName(updated)} (${updated.start_date} to ${updated.end_date}) was cancelled.`,
            data: { bookingId: updated.id },
        };
        if (!relations.has('renter')) notify(updated.renter_id, payload);
        if (!relations.has('owner')) notify(updated.owner_id, payload);
        return res.json({ data: client });
    }),
);

// Owner (or assigned driver) hands the equipment over to the renter
router.patch(
    '/:id/start',
    auth(true),
    asyncHandler(async (req, res) => {
        const { updated, client } = await applyTransition(req, 'start', {
            // An online booking is handed over only once the money is in; cash bookings are paid on delivery.
            verify: (booking) => {
                if (booking.payment_method === 'razorpay' && booking.payment_status !== 'paid') {
                    throw new BookingError(409, 'PAYMENT_REQUIRED', 'The renter has not paid for this booking yet.');
                }
            },
        });
        notify(updated.renter_id, {
            type: 'booking_update',
            title: 'Rental Started',
            message: `${equipmentName(updated)} has been handed over. Enjoy your rental!`,
            data: { bookingId: updated.id },
        });
        return res.json({ data: client });
    }),
);

// Renter signals they are returning the equipment; the response carries the completion code
router.post(
    '/:id/return',
    auth(true),
    asyncHandler(async (req, res) => {
        const { updated, client } = await applyTransition(req, 'return');
        client.completion_otp = lifecycle.completionOtp(updated, getJwtSecret());
        notify(updated.owner_id, {
            type: 'booking_update',
            title: 'Equipment Being Returned',
            message: `The renter is returning ${equipmentName(updated)}. Ask them for the completion code.`,
            data: { bookingId: updated.id },
        });
        return res.json({ data: client });
    }),
);

// Owner/driver completes with the renter's code; admins may complete without it
const completeRental = asyncHandler(async (req, res) => {
    const secret = getJwtSecret();
    const { updated, client } = await applyTransition(req, 'complete', {
        verify: (booking, relations) => {
            if (relations.has('admin')) return;
            if (!req.body.otp) throw new BookingError(400, 'OTP_REQUIRED', "Enter the completion code from the renter's booking page");
            if (!lifecycle.verifyCompletionOtp(booking, req.body.otp, secret)) {
                throw new BookingError(400, 'INVALID_OTP', 'Invalid completion code — check it with the renter');
            }
        },
    });
    await releaseDriver(updated.driver_id, { completedTrip: true });
    notify(updated.renter_id, {
        type: 'booking_confirmed',
        title: 'Rental Completed',
        message: `Your rental of ${equipmentName(updated)} is complete. Please leave a review!`,
        data: { bookingId: updated.id },
    });
    return res.json({ data: client });
});
router.post('/:id/complete', auth(true), completionLimiter, validate(schemas.bookingCompleteSchema), completeRental);
router.patch('/:id/complete', auth(true), completionLimiter, validate(schemas.bookingCompleteSchema), completeRental);

// ─── Extensions ──────────────────────────────────────────────────────────────

const addDays = (isoDate, days) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

router.post(
    '/:id/extensions',
    auth(true),
    validate(schemas.bookingExtensionCreateSchema),
    asyncHandler(async (req, res) => {
        const { booking, relations } = await loadBookingFor(req);
        if (!relations.has('renter')) throw new BookingError(403, 'FORBIDDEN', 'Only the renter can request an extension');
        if (!['approved', 'active'].includes(booking.status)) {
            throw new BookingError(409, 'INVALID_TRANSITION', 'Extensions can only be requested for confirmed or in-progress bookings');
        }

        const newEndDate = req.body.new_end_date;
        if (newEndDate <= booking.end_date) {
            throw new BookingError(400, 'INVALID_DATE_RANGE', 'The new end date must be after the current end date');
        }
        if (pricing.rentalDays(booking.start_date, newEndDate) > pricing.MAX_RENTAL_DAYS) {
            throw new BookingError(400, 'RENTAL_TOO_LONG', `A single booking can cover at most ${pricing.MAX_RENTAL_DAYS} days`);
        }
        if (await findConflict(booking.equipment_id, addDays(booking.end_date, 1), newEndDate, booking.id)) throw conflictError();

        const { data: pending, error: pendingError } = await db()
            .from('booking_extension_requests')
            .select('id')
            .eq('booking_id', booking.id)
            .eq('status', 'pending')
            .limit(1);
        if (pendingError) throw pendingError;
        if (pending?.length)
            throw new BookingError(409, 'EXTENSION_PENDING', 'There is already a pending extension request for this booking');

        const extraDays = pricing.rentalDays(booking.end_date, newEndDate) - 1;
        const { data: extension, error } = await db()
            .from('booking_extension_requests')
            .insert({
                booking_id: booking.id,
                new_end_date: newEndDate,
                extra_amount: pricing.extensionCharge(booking.daily_rate, extraDays),
                status: 'pending',
                reason: req.body.reason ?? null,
            })
            .select()
            .single();
        if (error) throw error;

        notify(booking.owner_id, {
            type: 'booking_extension_requested',
            title: 'Extension Requested',
            message: `The renter asked to extend ${equipmentName(booking)} until ${newEndDate}.`,
            data: { bookingId: booking.id, extensionId: extension.id },
        });
        return res.status(201).json({ success: true, data: extension });
    }),
);

router.get(
    '/:id/extensions',
    auth(true),
    asyncHandler(async (req, res) => {
        const { booking } = await loadBookingFor(req);
        const { data, error } = await db()
            .from('booking_extension_requests')
            .select('*')
            .eq('booking_id', booking.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json({ success: true, data: data || [] });
    }),
);

router.patch(
    '/:id/extensions/:extId',
    auth(true),
    validate(schemas.bookingExtensionRespondSchema),
    asyncHandler(async (req, res) => {
        const { booking, relations } = await loadBookingFor(req);
        if (!relations.has('owner') && !relations.has('admin')) {
            throw new BookingError(403, 'FORBIDDEN', 'Only the equipment owner can respond to extension requests');
        }
        if (!UUID_RE.test(req.params.extId)) throw new BookingError(404, 'EXTENSION_NOT_FOUND', 'Extension request not found');

        const { data: extension, error: extError } = await db()
            .from('booking_extension_requests')
            .select('*')
            .eq('id', req.params.extId)
            .eq('booking_id', booking.id)
            .maybeSingle();
        if (extError) throw extError;
        if (!extension) throw new BookingError(404, 'EXTENSION_NOT_FOUND', 'Extension request not found');
        if (extension.status !== 'pending')
            throw new BookingError(409, 'EXTENSION_PROCESSED', 'This extension request has already been answered');

        const { status } = req.body;
        if (status === 'approved') {
            if (!['approved', 'active'].includes(booking.status)) {
                throw new BookingError(409, 'INVALID_TRANSITION', `Cannot extend a booking that is ${toClientStatus(booking.status)}`);
            }
            const { data: extended, error: extendError } = await db()
                .from('equipment_rentals')
                .update({
                    end_date: extension.new_end_date,
                    total_amount: Math.round((Number(booking.total_amount) + Number(extension.extra_amount)) * 100) / 100,
                })
                .eq('id', booking.id)
                .eq('status', booking.status)
                .eq('end_date', booking.end_date)
                .select('id')
                .maybeSingle();
            if (extendError?.code === EXCLUSION_VIOLATION) throw conflictError();
            if (extendError) throw extendError;
            if (!extended) throw new BookingError(409, 'BOOKING_CHANGED', 'This booking was just updated. Refresh and try again.');
            invalidateAvailability(booking.equipment_id);
        }

        const { data: answered, error: answerError } = await db()
            .from('booking_extension_requests')
            .update({ status })
            .eq('id', extension.id)
            .eq('status', 'pending')
            .select()
            .maybeSingle();
        if (answerError) throw answerError;
        if (!answered) throw new BookingError(409, 'EXTENSION_PROCESSED', 'This extension request has already been answered');

        notify(booking.renter_id, {
            type: `booking_extension_${status}`,
            title: status === 'approved' ? 'Extension Approved' : 'Extension Declined',
            message:
                status === 'approved'
                    ? `Your rental of ${equipmentName(booking)} now ends on ${extension.new_end_date}.`
                    : `The owner declined your extension request for ${equipmentName(booking)}.`,
            data: { bookingId: booking.id, extensionId: extension.id },
        });
        return res.json({ success: true, data: answered });
    }),
);

module.exports = router;
module.exports.toClientBooking = toClientBooking;
