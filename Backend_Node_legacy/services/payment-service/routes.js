/**
 * Razorpay payments — /api/payment
 *
 * - The amount charged is always the booking's server-computed total_amount; clients only name the booking.
 * - Paying marks payment_status = paid. It does not confirm the booking: the owner still accepts it
 *   (booking-service/lifecycle.js), and rejecting or cancelling a paid booking refunds it.
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const Razorpay = require('razorpay');

const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');
const emailService = require('../../lib/emailService');
const { HttpError } = require('../../lib/httpError');
const { sendNotification } = require('../../lib/notificationService');
const { sendSMS } = require('../../lib/otpService');
const { asyncHandler } = require('../../middleware/asyncHandler');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/requireRole');
const { idempotency } = require('../../middleware/idempotency');
const { validate } = require('../../middleware/validate');
const { createOrderSchema, verifyPaymentSchema, partialRefundSchema } = require('../../validations/schemas');
const { refundBookingPayment } = require('./refunds');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

function razorpayClient() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not available right now. Please choose cash on delivery.');
    }
    if (!/^rzp_(live|test)_/.test(keyId)) {
        logger.error('[payment] RAZORPAY_KEY_ID must start with rzp_live_ or rzp_test_');
        throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not available right now. Please choose cash on delivery.');
    }
    if (process.env.NODE_ENV === 'production' && keyId.startsWith('rzp_test_')) {
        logger.warn('[payment] Using Razorpay TEST key in production — switch to rzp_live_ before going live');
    }
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

const isAdmin = (user) => Boolean(user?.roles?.includes('admin'));

function timingSafeEqualHex(expected, received) {
    return (
        typeof received === 'string' &&
        received.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
    );
}

function notify(userId, payload) {
    if (!userId) return;
    sendNotification(userId, payload).catch((err) => logger.warn('[payment] notification enqueue failed', { userId, error: err.message }));
}

async function bookingForParty(bookingId, user, select) {
    if (!UUID_RE.test(String(bookingId))) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const { data, error } = await db().from('equipment_rentals').select(select).eq('id', bookingId).maybeSingle();
    if (error) throw error;
    if (!data || (data.renter_id !== user.id && data.owner_id !== user.id && !isAdmin(user))) {
        throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    return data;
}

// ── CREATE ORDER — POST /api/payment/create-order ────────────────────────────
router.post(
    '/create-order',
    auth(true),
    requireRole('farmer', 'buyer', 'admin'),
    validate(createOrderSchema),
    idempotency(),
    asyncHandler(async (req, res) => {
        const booking = await bookingForParty(
            req.body.bookingId,
            req.user,
            'id, renter_id, owner_id, status, total_amount, payment_status',
        );
        if (booking.renter_id !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'Only the renter can pay for this booking');
        if (!['requested', 'approved'].includes(booking.status)) {
            throw new HttpError(409, 'BOOKING_NOT_PAYABLE', 'This booking can no longer be paid');
        }
        if (booking.payment_status !== 'pending') throw new HttpError(409, 'ALREADY_PAID', 'This booking has already been paid');

        const amount = Number(booking.total_amount);
        const keyId = process.env.RAZORPAY_KEY_ID;

        // Reuse the open order for this booking so retries never create a second chargeable order.
        const { data: open, error: openError } = await db()
            .from('payments')
            .select('gateway_order_id, amount, currency')
            .eq('reference_id', booking.id)
            .eq('status', 'created')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (openError) throw openError;
        if (open && Number(open.amount) === amount) {
            return res.json({
                orderId: open.gateway_order_id,
                amount: Math.round(amount * 100),
                currency: open.currency,
                keyId,
                bookingId: booking.id,
            });
        }

        const razorpay = razorpayClient();
        let order;
        try {
            order = await razorpay.orders.create({
                amount: Math.round(amount * 100),
                currency: 'INR',
                receipt: booking.id,
                notes: { bookingId: booking.id },
            });
        } catch (err) {
            logger.error('[payment/create-order] Razorpay order creation failed', {
                bookingId: booking.id,
                error: err?.error?.description || err.message,
            });
            throw new HttpError(502, 'GATEWAY_ERROR', 'Could not start the payment. Please try again.');
        }

        // Without this row the captured payment could never be matched back to the booking, so failure aborts.
        const { error: insertError } = await db()
            .from('payments')
            .insert({
                payer_id: booking.renter_id,
                payee_id: booking.owner_id,
                reference_id: booking.id,
                reference_type: 'rental',
                gateway_order_id: order.id,
                amount,
                currency: order.currency,
                status: 'created',
                idempotency_key: `order_${order.id}`,
            });
        if (insertError) throw insertError;

        return res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId, bookingId: booking.id });
    }),
);

// ── VERIFY PAYMENT — POST /api/payment/verify ────────────────────────────────
router.post(
    '/verify',
    auth(true),
    validate(verifyPaymentSchema),
    idempotency(),
    asyncHandler(async (req, res) => {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keySecret) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not configured');

        const expected = crypto.createHmac('sha256', keySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
        const isValid = timingSafeEqualHex(expected, razorpay_signature);

        const { error: logError } = await db()
            .from('payments_log')
            .insert({
                razorpay_order_id,
                razorpay_payment_id,
                success: isValid,
                message: isValid ? 'verified' : 'signature_mismatch',
            });
        if (logError) logger.warn('[payment/verify] could not record verification attempt', { error: logError.message });

        if (!isValid) throw new HttpError(400, 'SIGNATURE_MISMATCH', 'Payment verification failed');

        const { data: payment, error } = await db()
            .from('payments')
            .update({
                status: 'captured',
                gateway_payment_id: razorpay_payment_id,
                metadata: { verified_at: new Date().toISOString() },
            })
            .eq('gateway_order_id', razorpay_order_id)
            .eq('payer_id', req.user.id)
            .in('status', ['created', 'authorized', 'captured'])
            .select('reference_id, amount')
            .maybeSingle();
        if (error) throw error;
        if (!payment) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'No matching payment order was found');

        const { data: booking, error: bookingError } = await db()
            .from('equipment_rentals')
            .update({ payment_status: 'paid' })
            .eq('id', payment.reference_id)
            .eq('payment_status', 'pending')
            .select('id, renter_id, owner_id, equipment(name), renter:users!renter_id(email, full_name)')
            .maybeSingle();
        if (bookingError) throw bookingError;

        if (booking) {
            const amountInr = Number(payment.amount).toFixed(0);
            const equipmentName = booking.equipment?.name || 'your equipment';
            notify(booking.renter_id, {
                type: 'payment_success',
                title: 'Payment Successful',
                message: `Payment of ₹${amountInr} received for ${equipmentName}.`,
                data: { bookingId: booking.id, paymentId: razorpay_payment_id },
            });
            notify(booking.owner_id, {
                type: 'payment_success',
                title: 'Booking Paid',
                message: `The renter paid ₹${amountInr} for ${equipmentName}.`,
                data: { bookingId: booking.id },
            });
            if (booking.renter?.email) {
                emailService
                    .sendPaymentReceipt(booking.renter.email, {
                        userName: booking.renter.full_name,
                        equipmentName,
                        amountPaid: amountInr,
                        paymentId: razorpay_payment_id,
                        bookingId: booking.id,
                    })
                    .catch((err) => logger.warn('[payment/verify] receipt email failed', { bookingId: booking.id, error: err.message }));
            }
        }

        return res.json({ success: true, paymentId: razorpay_payment_id, bookingId: payment.reference_id });
    }),
);

// ── REFUND — POST /api/payment/refund ────────────────────────────────────────
// Cancelling or rejecting a paid booking refunds it automatically; this endpoint retries a refund that
// could not be issued then. Partial refunds (dispute settlements) are admin-only.
router.post(
    '/refund',
    auth(true),
    validate(partialRefundSchema),
    idempotency(),
    asyncHandler(async (req, res) => {
        const { bookingId, reason, amount } = req.body;
        const booking = await bookingForParty(bookingId, req.user, 'id, renter_id, owner_id, status, payment_status');

        if (amount != null && !isAdmin(req.user)) throw new HttpError(403, 'FORBIDDEN', 'Only an admin can issue a partial refund');
        if (!isAdmin(req.user) && !['cancelled', 'rejected'].includes(booking.status)) {
            throw new HttpError(
                409,
                'REFUND_NOT_ALLOWED',
                'Refunds are issued for cancelled or declined bookings. For other issues, raise a dispute.',
            );
        }
        if (booking.payment_status !== 'paid')
            throw new HttpError(409, 'NOTHING_TO_REFUND', 'There is no captured payment to refund for this booking');

        const result = await refundBookingPayment(booking, reason || 'Refund requested', { amount });
        if (result.status !== 'refunded') throw new HttpError(502, 'REFUND_FAILED', result.message);

        const message = `Refund of ₹${Number(result.amount).toFixed(0)} has been initiated.`;
        notify(booking.renter_id, { type: 'payment_success', title: 'Refund Initiated', message, data: { bookingId } });
        return res.json({
            success: true,
            refundId: result.refundId,
            refundedAmount: result.amount,
            message: 'Refund initiated successfully',
        });
    }),
);

// ── PAYMENT STATUS — GET /api/payment/status?orderId= ────────────────────────
router.get(
    '/status',
    auth(true),
    asyncHandler(async (req, res) => {
        const orderId = String(req.query.orderId || '').trim();
        if (!orderId) throw new HttpError(400, 'VALIDATION_ERROR', 'orderId is required');

        let query = db()
            .from('payments')
            .select('gateway_order_id, status, amount, currency, updated_at, failure_reason')
            .eq('gateway_order_id', orderId);
        if (!isAdmin(req.user)) query = query.eq('payer_id', req.user.id);
        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');

        return res.json({
            razorpay_order_id: data.gateway_order_id,
            status: data.status === 'captured' ? 'paid' : data.status,
            amount_paise: Math.round(Number(data.amount) * 100),
            currency: data.currency,
            paid_at: data.status === 'captured' ? data.updated_at : null,
            error_description: data.failure_reason,
        });
    }),
);

// ── REFUND STATUS — GET /api/payment/refund-status?bookingId= ────────────────
router.get(
    '/refund-status',
    auth(true),
    asyncHandler(async (req, res) => {
        const booking = await bookingForParty(req.query.bookingId, req.user, 'id, renter_id, owner_id');

        const { data, error } = await db()
            .from('payments')
            .select('status, refund_amount, metadata, failure_reason')
            .eq('reference_id', booking.id)
            .in('status', ['refunded', 'partially_refunded'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.json({ refund: null });

        return res.json({
            refund: {
                status: data.status,
                refund_id: data.metadata?.refund_id || null,
                refunded_at: data.metadata?.refunded_at || null,
                refund_amount_paise: Math.round(Number(data.refund_amount || 0) * 100),
                refund_reason: data.metadata?.refund_reason || data.failure_reason || null,
            },
        });
    }),
);

// ── WEBHOOK — POST /api/payment/webhook ──────────────────────────────────────

async function notifyPaidBySms(bookingId, amountInr) {
    const { data: booking, error } = await db()
        .from('equipment_rentals')
        .select('renter:users!renter_id(phone), owner:users!owner_id(phone)')
        .eq('id', bookingId)
        .maybeSingle();
    if (error) throw error;
    const messages = [
        [booking?.renter?.phone, `FarmRent: Payment of Rs.${amountInr} received for booking ${bookingId}. The owner will confirm shortly.`],
        [booking?.owner?.phone, `FarmRent: A renter paid Rs.${amountInr} for booking ${bookingId}. Please confirm it in the app.`],
    ];
    await Promise.all(messages.filter(([phone]) => phone).map(([phone, text]) => sendSMS(phone, text)));
}

async function handleWebhookEvent(payload) {
    const event = payload?.event;
    const paymentEntity = payload?.payload?.payment?.entity;
    const refundEntity = payload?.payload?.refund?.entity;

    if (event === 'payment.captured' || event === 'order.paid') {
        const orderId = paymentEntity?.order_id || payload?.payload?.order?.entity?.id;
        if (!orderId) return;
        const { data: payment, error } = await db()
            .from('payments')
            .update({ status: 'captured', ...(paymentEntity?.id && { gateway_payment_id: paymentEntity.id }) })
            .eq('gateway_order_id', orderId)
            .in('status', ['created', 'authorized'])
            .select('reference_id, amount')
            .maybeSingle();
        if (error) throw error;
        if (!payment) return; // already recorded by /verify

        const { data: booking, error: bookingError } = await db()
            .from('equipment_rentals')
            .update({ payment_status: 'paid' })
            .eq('id', payment.reference_id)
            .eq('payment_status', 'pending')
            .select('id, renter_id, owner_id')
            .maybeSingle();
        if (bookingError) throw bookingError;
        if (!booking) return;

        const amountInr = Number(payment.amount).toFixed(0);
        notify(booking.renter_id, {
            type: 'payment_success',
            title: 'Payment Confirmed',
            message: `Payment of ₹${amountInr} received.`,
            data: { bookingId: booking.id },
        });
        notify(booking.owner_id, {
            type: 'payment_success',
            title: 'Booking Paid',
            message: `The renter paid ₹${amountInr}.`,
            data: { bookingId: booking.id },
        });
        await notifyPaidBySms(booking.id, amountInr);
        return;
    }

    if (event === 'payment.failed') {
        if (!paymentEntity?.order_id) return;
        const { error } = await db()
            .from('payments')
            .update({ status: 'failed', failure_reason: String(paymentEntity.error_description || 'Payment failed') })
            .eq('gateway_order_id', paymentEntity.order_id)
            .in('status', ['created', 'authorized']);
        if (error) throw error;
        return;
    }

    if (event === 'refund.processed' || event === 'refund.created') {
        if (!refundEntity?.payment_id) return;
        const { error } = await db()
            .from('payments')
            .update({ status: 'refunded', refund_amount: Number(refundEntity.amount) / 100 })
            .eq('gateway_payment_id', refundEntity.payment_id)
            .eq('status', 'captured');
        if (error) throw error;
        return;
    }

    if (event === 'refund.failed') {
        logger.error('[webhook] Razorpay reported a failed refund', { paymentId: refundEntity?.payment_id, refundId: refundEntity?.id });
        if (!refundEntity?.payment_id) return;
        const { error } = await db()
            .from('payments')
            .update({ failure_reason: 'Refund failed at gateway' })
            .eq('gateway_payment_id', refundEntity.payment_id);
        if (error) throw error;
        return;
    }

    logger.info('[webhook] event ignored', { event });
}

router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        logger.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook');
        return res.status(503).json({ status: 'error', message: 'Webhook not configured' });
    }
    if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ status: 'error', message: 'Expected a JSON body' });
    }

    const expected = crypto.createHmac('sha256', webhookSecret).update(req.body).digest('hex');
    if (!timingSafeEqualHex(expected, req.headers['x-razorpay-signature'])) {
        logger.warn('[webhook] signature mismatch');
        return res.status(400).json({ status: 'error', message: 'Invalid signature' });
    }

    let payload;
    try {
        payload = JSON.parse(req.body.toString('utf8'));
    } catch {
        return res.status(400).json({ status: 'error', message: 'Invalid JSON' });
    }

    // Razorpay requires a quick 2xx; process after responding.
    res.status(200).json({ status: 'ok' });
    setImmediate(() => {
        handleWebhookEvent(payload).catch((err) => logger.error('[webhook] handler error', { event: payload?.event, error: err.message }));
    });
});

module.exports = router;
