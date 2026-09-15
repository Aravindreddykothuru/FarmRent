/**
 * Refunds for rental payments captured through Razorpay.
 */
'use strict';

const Razorpay = require('razorpay');
const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');

function razorpayClient() {
    const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret } = process.env;
    if (!keyId || !keySecret) return null;
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * Refunds the captured payment of a booking, if it has one.
 *
 * Resolves to { status: 'not_applicable' | 'refunded' | 'failed', ... } instead of throwing: callers use it
 * after a cancellation is already committed, and a gateway outage must not turn that into an error response.
 * Every failure is logged with the booking id so the refund can be completed by hand.
 */
async function refundBookingPayment(booking, reason, { amount } = {}) {
    if (!booking || booking.payment_status !== 'paid') return { status: 'not_applicable' };

    const { data: payment, error } = await supabase
        .from('payments')
        .select('id, gateway_payment_id, amount, metadata')
        .eq('reference_id', booking.id)
        .eq('status', 'captured')
        .maybeSingle();
    if (error || !payment) {
        logger.error('[refund] booking is marked paid but no captured payment could be loaded', {
            bookingId: booking.id,
            error: error?.message,
        });
        return { status: 'failed', message: 'No captured payment found for this booking; our team will follow up' };
    }

    const client = razorpayClient();
    if (!client) {
        logger.error('[refund] Razorpay is not configured; refund needs manual action', { bookingId: booking.id, paymentId: payment.id });
        return { status: 'failed', message: 'Refund could not be issued automatically; our team will follow up' };
    }

    const paid = Number(payment.amount);
    const refundAmount = Math.min(Number(amount ?? paid), paid);
    let refund;
    try {
        refund = await client.payments.refund(payment.gateway_payment_id, {
            amount: Math.round(refundAmount * 100),
            notes: { bookingId: booking.id, reason: String(reason).slice(0, 250) },
        });
    } catch (err) {
        logger.error('[refund] gateway refund failed', {
            bookingId: booking.id,
            paymentId: payment.id,
            error: err?.error?.description || err.message,
        });
        return { status: 'failed', message: 'Refund could not be issued automatically; our team will follow up' };
    }

    const fullRefund = refundAmount >= paid;
    const refundedAt = new Date().toISOString();
    const { error: paymentError } = await supabase
        .from('payments')
        .update({
            status: fullRefund ? 'refunded' : 'partially_refunded',
            refund_amount: refundAmount,
            metadata: { ...(payment.metadata || {}), refund_id: refund.id, refunded_at: refundedAt, refund_reason: reason },
        })
        .eq('id', payment.id);
    const { error: bookingError } = fullRefund
        ? await supabase.from('equipment_rentals').update({ payment_status: 'refunded' }).eq('id', booking.id)
        : { error: null };
    if (paymentError || bookingError) {
        logger.error('[refund] refund issued but recording it failed', {
            bookingId: booking.id,
            refundId: refund.id,
            error: (paymentError || bookingError).message,
        });
    }

    return { status: 'refunded', refundId: refund.id, amount: refundAmount, refundedAt };
}

module.exports = { refundBookingPayment };
