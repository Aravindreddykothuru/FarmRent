/**
 * Server-side rental pricing — the single source of truth for what a booking costs.
 *
 *   rental subtotal  = daily rate × inclusive days
 *   service fee      = SERVICE_FEE_PERCENT of the subtotal, rounded to the rupee   (default 3%)
 *   security deposit = the listing's deposit_amount
 *   delivery charge  = DELIVERY_CHARGE_INR when the renter asks for delivery      (default ₹500)
 *   promo discount   = applied to the rental subtotal
 *   total            = subtotal + service fee + deposit + delivery − discount
 *
 * Clients never supply amounts; they request a quote (GET /api/v1/bookings/quote) and the booking is
 * priced again, with the same function, when it is created.
 */
'use strict';

const { BookingError } = require('./lifecycle');

function moneySetting(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a non-negative number (got "${raw}")`);
    }
    return value;
}

const SERVICE_FEE_RATE = moneySetting('SERVICE_FEE_PERCENT', 3) / 100;
const DELIVERY_CHARGE = moneySetting('DELIVERY_CHARGE_INR', 500);
const MAX_RENTAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const roundMoney = (value) => Math.round(value * 100) / 100;

/** Today's calendar date in UTC. India is ahead of UTC, so this never rejects "today" for an Indian user. */
function todayIso(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

/** Inclusive number of rental days between two YYYY-MM-DD dates. */
function rentalDays(startDate, endDate) {
    return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS) + 1;
}

function assertBookableRange(startDate, endDate, now = new Date()) {
    if (startDate < todayIso(now)) {
        throw new BookingError(400, 'START_DATE_IN_PAST', 'Start date cannot be in the past');
    }
    if (endDate < startDate) {
        throw new BookingError(400, 'INVALID_DATE_RANGE', 'End date must be on or after the start date');
    }
    const days = rentalDays(startDate, endDate);
    if (days > MAX_RENTAL_DAYS) {
        throw new BookingError(400, 'RENTAL_TOO_LONG', `A single booking can cover at most ${MAX_RENTAL_DAYS} days`);
    }
    return days;
}

/** Discount for a promo_codes row against a rental subtotal; throws BookingError when the code cannot be used. */
function promoDiscount(promo, subtotal, now = new Date()) {
    if (!promo || !promo.is_active) {
        throw new BookingError(404, 'PROMO_INVALID', 'Invalid or expired promo code');
    }
    if (promo.expires_at && new Date(promo.expires_at) <= now) {
        throw new BookingError(400, 'PROMO_EXPIRED', 'This promo code has expired');
    }
    if (promo.usage_limit != null && promo.used_count >= promo.usage_limit) {
        throw new BookingError(400, 'PROMO_EXHAUSTED', 'This promo code has reached its usage limit');
    }
    const minimum = Number(promo.min_order_value) || 0;
    if (subtotal < minimum) {
        throw new BookingError(400, 'PROMO_MINIMUM_NOT_MET', `Minimum rental of ₹${minimum} required for this code`);
    }

    const value = Number(promo.discount_value);
    let discount = promo.discount_type === 'percent' ? (subtotal * value) / 100 : value;
    if (promo.max_discount != null) discount = Math.min(discount, Number(promo.max_discount));
    return roundMoney(Math.min(discount, subtotal));
}

const serviceFeeFor = (rentalAmount) => Math.round(rentalAmount * SERVICE_FEE_RATE);

/** Full price breakdown for a rental. `promo` is an optional promo_codes row. */
function quoteRental({ dailyRate, startDate, endDate, deposit = 0, deliveryMode = 'pickup', promo = null, now = new Date() }) {
    const rate = Number(dailyRate);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new BookingError(409, 'EQUIPMENT_NOT_PRICED', 'This equipment has no valid daily rate');
    }
    const days = assertBookableRange(startDate, endDate, now);
    const subtotal = roundMoney(rate * days);
    const serviceFee = serviceFeeFor(subtotal);
    const depositAmount = roundMoney(Number(deposit) || 0);
    const deliveryCharge = deliveryMode === 'delivery' ? DELIVERY_CHARGE : 0;
    const discount = promo ? promoDiscount(promo, subtotal, now) : 0;
    const total = roundMoney(Math.max(0, subtotal + serviceFee + depositAmount + deliveryCharge - discount));
    return { days, dailyRate: rate, subtotal, serviceFee, deposit: depositAmount, deliveryCharge, discount, total };
}

/** Additional charge for extending a rental by `extraDays` (rent plus the service fee on it). */
function extensionCharge(dailyRate, extraDays) {
    const rent = roundMoney(Number(dailyRate) * extraDays);
    return roundMoney(rent + serviceFeeFor(rent));
}

module.exports = {
    MAX_RENTAL_DAYS,
    SERVICE_FEE_RATE,
    DELIVERY_CHARGE,
    todayIso,
    rentalDays,
    assertBookableRange,
    promoDiscount,
    quoteRental,
    extensionCharge,
};
