/**
 * Rental lifecycle — the one place that decides which status change is legal and who may make it.
 *
 *   requested ──accept──▶ approved ──start──▶ active ──return──▶ return_pending ──complete──▶ completed
 *       │                    │                   └──────────────complete──────────────────────▲
 *       ├──reject──▶ rejected │
 *       └──cancel──▶ cancelled ◀──cancel──┘
 *
 * Route handlers call assertTransition() for the authorization/state check and then apply the
 * update conditioned on the current status, so a concurrent change can never skip a state.
 */
'use strict';

const crypto = require('crypto');
const { HttpError } = require('../../lib/httpError');

// Statuses that hold the equipment for their date range (mirrors equipment_rentals_no_overlap).
const LIVE_STATUSES = Object.freeze(['requested', 'approved', 'active', 'return_pending']);

const TRANSITIONS = Object.freeze({
    accept: { from: ['requested'], to: 'approved', actors: ['owner', 'admin'], timestamp: 'accepted_at' },
    reject: { from: ['requested'], to: 'rejected', actors: ['owner', 'admin'], timestamp: 'rejected_at' },
    cancel: { from: ['requested', 'approved'], to: 'cancelled', actors: ['renter', 'owner', 'admin'], timestamp: 'cancelled_at' },
    start: { from: ['approved'], to: 'active', actors: ['owner', 'driver', 'admin'], timestamp: 'started_at' },
    return: { from: ['active'], to: 'return_pending', actors: ['renter'], timestamp: 'return_requested_at' },
    complete: { from: ['active', 'return_pending'], to: 'completed', actors: ['owner', 'driver', 'admin'], timestamp: 'completed_at' },
});

// Stored status -> name the web client renders (it predates the requested/approved/active names).
const CLIENT_STATUS = Object.freeze({ requested: 'pending', approved: 'confirmed', active: 'in_progress' });
const DB_STATUS = Object.freeze(Object.fromEntries(Object.entries(CLIENT_STATUS).map(([db, client]) => [client, db])));

const toClientStatus = (status) => CLIENT_STATUS[status] || status;
const toDbStatus = (status) => DB_STATUS[status] || status;

class BookingError extends HttpError {}

/** The ways `user` is related to `booking`: renter, owner, driver (by driver profile id), admin. */
function relationsTo(booking, user, driverId = null) {
    const relations = new Set();
    if (!booking || !user) return relations;
    if (booking.renter_id && booking.renter_id === user.id) relations.add('renter');
    if (booking.owner_id && booking.owner_id === user.id) relations.add('owner');
    if (driverId && booking.driver_id && booking.driver_id === driverId) relations.add('driver');
    if (Array.isArray(user.roles) && user.roles.includes('admin')) relations.add('admin');
    return relations;
}

/** Returns the transition rule, or throws BookingError (403 wrong actor, 409 wrong state). */
function assertTransition(action, booking, relations) {
    const rule = TRANSITIONS[action];
    if (!rule) throw new BookingError(400, 'UNKNOWN_ACTION', `Unknown booking action "${action}"`);
    if (!rule.actors.some((actor) => relations.has(actor))) {
        throw new BookingError(403, 'FORBIDDEN', `Only the ${rule.actors.join(' or ')} can ${action} this booking`);
    }
    if (!rule.from.includes(booking.status)) {
        throw new BookingError(409, 'INVALID_TRANSITION', `Cannot ${action} a booking that is ${toClientStatus(booking.status)}`, {
            status: toClientStatus(booking.status),
            allowedFrom: rule.from.map(toClientStatus),
        });
    }
    return rule;
}

/**
 * Six-digit code the renter hands to the owner at return; the owner needs it to complete the rental.
 * Derived from the booking and its handover time, so nothing is stored and it changes per handover.
 */
function completionOtp(booking, secret) {
    if (!booking?.id || !booking?.started_at) return null;
    const mac = crypto.createHmac('sha256', secret).update(`completion:${booking.id}:${booking.started_at}`).digest();
    return String(mac.readUInt32BE(0) % 1000000).padStart(6, '0');
}

function verifyCompletionOtp(booking, otp, secret) {
    const expected = completionOtp(booking, secret);
    if (!expected || typeof otp !== 'string' || otp.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(otp));
}

module.exports = {
    LIVE_STATUSES,
    TRANSITIONS,
    BookingError,
    toClientStatus,
    toDbStatus,
    relationsTo,
    assertTransition,
    completionOtp,
    verifyCompletionOtp,
};
