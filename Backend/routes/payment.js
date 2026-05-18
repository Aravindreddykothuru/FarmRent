const express  = require('express');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const supabase = require('../lib/supabase');
const { sendNotification } = require('../lib/notificationService');
const emailService = require('../lib/emailService');
const { sendSMS } = require('../lib/otpService');
const { auth } = require('../middleware/auth');
const { triggerRefund } = require('../lib/refundService');
const logger   = require('../lib/logger');

const router = express.Router();

function getRazorpay() {
    const keyId     = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw new Error('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Backend/.env');
    }
    const isLive = keyId.startsWith('rzp_live_');
    const isTest = keyId.startsWith('rzp_test_');
    if (!isLive && !isTest) {
        throw new Error('RAZORPAY_KEY_ID must start with rzp_live_ or rzp_test_');
    }
    if (process.env.NODE_ENV === 'production' && !isLive) {
        logger.warn('[payment] Using Razorpay TEST key in production — switch to rzp_live_ before going live');
    }
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function inrToPaise(amount) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return null;
    return Math.round(a * 100);
}

async function logVerificationAttempt(row) {
    if (!supabase) return;
    await supabase.from('payments_log').insert(row);
}

// ── CREATE ORDER — POST /api/payment/create-order ────────────────────────────
router.post('/create-order', async (req, res) => {
    try {
        const { amount, currency = 'INR', receipt, notes } = req.body || {};
        const amountPaise = inrToPaise(amount);
        if (!amountPaise) return res.status(400).json({ message: 'A valid amount is required' });

        const razorpay = getRazorpay();
        const order = await razorpay.orders.create({
            amount:   amountPaise,
            currency: currency || 'INR',
            receipt,
            notes,
        });

        const userId    = req.user?.id || req.user?.sub || null;
        const bookingId = notes?.bookingId || receipt || null;
        if (supabase) {
            await supabase.from('payments').insert({
                user_id:           userId,          // nullable — no FK violation
                razorpay_order_id: order.id,
                amount_paise:      order.amount,
                currency:          order.currency,
                status:            'pending',
                booking_id:        bookingId || null,
            }).catch(() => {});
        }

        return res.json({
            orderId:  order.id,
            amount:   order.amount,
            currency: order.currency,
            keyId:    process.env.RAZORPAY_KEY_ID,
        });
    } catch (err) {
        logger.error('[payment/create-order]', { error: err.message });
        return res.status(500).json({ message: err.message || 'Order creation failed' });
    }
});

// ── VERIFY PAYMENT — POST /api/payment/verify ────────────────────────────────
router.post('/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
        return res.status(503).json({ success: false, message: 'Payment not configured' });
    }

    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    const isValid = expected === razorpay_signature;

    await logVerificationAttempt({
        razorpay_order_id,
        razorpay_payment_id,
        success:    isValid,
        message:    isValid ? 'verified' : 'signature_mismatch',
        created_at: new Date().toISOString(),
    });

    if (!isValid) {
        return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    if (supabase) {
        // Mark payment paid
        const { data: payRow } = await supabase.from('payments').update({
            status:              'paid',
            razorpay_payment_id,
            razorpay_signature,
            paid_at:             new Date().toISOString(),
        }).eq('razorpay_order_id', razorpay_order_id).select('booking_id, user_id, amount_paise').maybeSingle();

        // Confirm the linked booking immediately (don't wait for webhook)
        if (payRow?.booking_id) {
            await supabase.from('bookings').update({
                status:         'confirmed',
                payment_status: 'paid',
            }).eq('id', payRow.booking_id).eq('status', 'pending');
        }
    }

    // Fire-and-forget: notify + email
    const userId = req.user?.id || null;
    if (userId && supabase) {
        supabase.from('payments')
            .select('amount_paise, booking_id')
            .eq('razorpay_order_id', razorpay_order_id)
            .single()
            .then(({ data: payRow }) => {
                if (!payRow) return;
                const amountInr = payRow.amount_paise ? (payRow.amount_paise / 100).toFixed(0) : '';
                sendNotification(userId, {
                    type:    'payment_success',
                    title:   'Payment Successful',
                    message: amountInr ? `Payment of ₹${amountInr} received.` : 'Your payment was successful.',
                    data:    { bookingId: payRow.booking_id, paymentId: razorpay_payment_id },
                }).catch(() => {});
                supabase.from('users').select('email,name').eq('id', userId).single()
                    .then(({ data: user }) => {
                        if (user) {
                            emailService.sendPaymentReceipt(user.email, {
                                userName:      user.name,
                                equipmentName: 'Equipment',
                                amountPaid:    amountInr,
                                paymentId:     razorpay_payment_id,
                                bookingId:     payRow.booking_id || '',
                            }).catch(() => {});
                        }
                    }).catch(() => {});
            }).catch(() => {});
    }

    return res.json({ success: true, paymentId: razorpay_payment_id });
});

// ── REFUND (full or partial) — POST /api/payment/refund ──────────────────────
router.post('/refund', auth(true), async (req, res) => {
    const { bookingId, reason, amount } = req.body || {};
    if (!bookingId) return res.status(400).json({ success: false, message: 'bookingId is required' });
    if (!supabase)  return res.status(503).json({ success: false, message: 'DB unavailable' });

    try {
        const { data: booking } = await supabase
            .from('bookings')
            .select('id, renter_id, owner_id, status')
            .eq('id', bookingId)
            .single();
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
        const uid = req.user?.id || req.user?.sub;
        if (booking.renter_id !== uid && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const { data: payment } = await supabase
            .from('payments')
            .select('id, razorpay_payment_id, amount_paise, status')
            .eq('booking_id', bookingId)
            .eq('status', 'paid')
            .maybeSingle();
        if (!payment) return res.status(400).json({ success: false, message: 'No paid payment found for this booking' });

        // Partial refund: caller may pass amount in INR; clamp to paid amount
        const refundAmountPaise = amount
            ? Math.min(Math.round(Number(amount) * 100), payment.amount_paise)
            : null; // null = full refund (triggerRefund will use payment.amount_paise)

        const refundPayload = refundAmountPaise
            ? { ...payment, amount_paise: refundAmountPaise }
            : payment;

        const refund = await triggerRefund(refundPayload, reason || 'Booking cancelled by customer');
        await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);

        const refundedInr = ((refundAmountPaise || payment.amount_paise) / 100).toFixed(0);
        const msg = `Refund of ₹${refundedInr} has been initiated.`;
        if (booking.renter_id) sendNotification(booking.renter_id, { type: 'payment_success', title: 'Refund Initiated', message: msg, data: { bookingId } }).catch(() => {});
        if (booking.owner_id)  sendNotification(booking.owner_id,  { type: 'booking_cancelled', title: 'Booking Cancelled', message: 'A booking was cancelled and refunded.', data: { bookingId } }).catch(() => {});

        return res.json({ success: true, refundId: refund.id, refundedAmount: refundedInr, message: 'Refund initiated successfully' });
    } catch (e) {
        logger.error('[payment/refund]', { error: e.message });
        return res.status(500).json({ success: false, message: e.message || 'Refund failed' });
    }
});

// ── PAYMENT STATUS — GET /api/payment/status?orderId= ────────────────────────
router.get('/status', async (req, res) => {
    const { orderId } = req.query;
    if (!orderId)  return res.status(400).json({ error: 'orderId required' });
    if (!supabase) return res.status(503).json({ error: 'DB unavailable' });

    const { data, error } = await supabase
        .from('payments')
        .select('razorpay_order_id,status,amount_paise,currency,paid_at,error_description')
        .eq('razorpay_order_id', String(orderId))
        .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Payment not found' });
    return res.json(data);
});

// ── REFUND STATUS — GET /api/payment/refund-status?bookingId= ────────────────
router.get('/refund-status', async (req, res) => {
    const { bookingId } = req.query;
    if (!bookingId || !supabase) return res.json({ refund: null });

    const { data } = await supabase
        .from('payments')
        .select('status, refund_id, refunded_at, refund_amount_paise, refund_reason')
        .eq('booking_id', bookingId)
        .maybeSingle();

    return res.json({ refund: data || null });
});

// ── WEBHOOK — POST /api/payment/webhook ──────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const signature  = req.headers['x-razorpay-signature'];
    const webhookSec = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSec) {
        logger.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting all webhook requests');
        return res.status(500).send('Webhook secret not configured');
    }
    const expected = crypto.createHmac('sha256', webhookSec).update(req.body).digest('hex');
    if (signature !== expected) {
        logger.warn('[webhook] Signature mismatch', { received: signature });
        return res.status(400).send('Invalid signature');
    }

    // Respond immediately (Razorpay requires < 5s response)
    res.status(200).json({ status: 'ok' });

    setImmediate(async () => {
        try {
            if (!supabase) return;
            const payload = JSON.parse(req.body.toString('utf8'));
            const event   = payload?.event;
            logger.info('[webhook] Received event', { event });

            if (event === 'payment.captured') {
                const entity    = payload?.payload?.payment?.entity;
                const orderId   = entity?.order_id;
                const paymentId = entity?.id;
                const amountPaise = entity?.amount;
                if (!orderId) return;

                await supabase.from('payments').update({
                    status:              'paid',
                    razorpay_payment_id: paymentId,
                    paid_at:             new Date().toISOString(),
                    amount_paise:        amountPaise,
                }).eq('razorpay_order_id', orderId);

                // Confirm the booking
                const { data: payment } = await supabase
                    .from('payments').select('booking_id, user_id').eq('razorpay_order_id', orderId).maybeSingle();
                if (payment?.booking_id) {
                    await supabase.from('bookings')
                        .update({ status: 'confirmed', payment_status: 'paid' })
                        .eq('id', payment.booking_id)
                        .eq('status', 'pending');

                    const { data: booking } = await supabase
                        .from('bookings').select('renter_id, owner_id').eq('id', payment.booking_id).maybeSingle();
                    const amtInr = amountPaise ? (amountPaise / 100).toFixed(0) : '';
                    const notif  = { type: 'payment_success', title: 'Payment Confirmed', message: `Payment of ₹${amtInr} received. Booking confirmed!`, data: { bookingId: payment.booking_id, paymentId } };
                    if (booking?.renter_id) sendNotification(booking.renter_id, notif).catch(() => {});
                    if (booking?.owner_id)  sendNotification(booking.owner_id, { ...notif, title: 'New Booking Paid' }).catch(() => {});

                    // SMS to farmer and owner
                    if (booking?.renter_id || booking?.owner_id) {
                        const { data: users } = await supabase
                            .from('users')
                            .select('id, phone, name')
                            .in('id', [booking?.renter_id, booking?.owner_id].filter(Boolean));

                        for (const u of users || []) {
                            if (!u.phone) continue;
                            const isFarmer = u.id === booking.renter_id;
                            const msg = isFarmer
                                ? `FarmRent: Your booking is confirmed! Payment of Rs.${amtInr} received. Booking ID: ${payment.booking_id}`
                                : `FarmRent: New booking confirmed! Payment of Rs.${amtInr} received from a farmer. Booking ID: ${payment.booking_id}`;
                            sendSMS(u.phone, msg).catch(() => {});
                        }
                    }
                }
            }

            if (event === 'payment.failed') {
                const entity  = payload?.payload?.payment?.entity;
                const orderId = entity?.order_id;
                const desc    = entity?.error_description || 'Payment failed';
                if (orderId) await supabase.from('payments')
                    .update({ status: 'failed', error_description: String(desc) })
                    .eq('razorpay_order_id', orderId);
            }

            if (event === 'refund.created') {
                const refund    = payload?.payload?.refund?.entity;
                const paymentId = refund?.payment_id;
                const refundId  = refund?.id;
                const amount    = refund?.amount;
                if (paymentId) await supabase.from('payments').update({
                    refund_id:           refundId,
                    refund_amount_paise: amount,
                    refunded_at:         new Date().toISOString(),
                    status:              'refunded',
                }).eq('razorpay_payment_id', paymentId);
            }

            if (event === 'refund.failed') {
                const paymentId = payload?.payload?.refund?.entity?.payment_id;
                if (paymentId) await supabase.from('payments').update({
                    error_description: 'Refund failed — please retry',
                }).eq('razorpay_payment_id', paymentId);
            }

            if (event === 'order.paid') {
                const orderId = payload?.payload?.order?.entity?.id;
                if (orderId) await supabase.from('payments')
                    .update({ status: 'paid' })
                    .eq('razorpay_order_id', orderId)
                    .eq('status', 'pending');
            }
        } catch (e) {
            logger.error('[webhook] Handler error', { error: e.message });
        }
    });
});

module.exports = router;
