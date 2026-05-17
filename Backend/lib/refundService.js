const supabase = require('./supabase');

function getRazorpay() {
    const Razorpay = require('razorpay');
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('Razorpay keys not configured');
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * Trigger a Razorpay refund for a payment row and update the DB.
 * @param {{ id: string, razorpay_payment_id: string, amount_paise: number }} paymentRow
 * @param {string} [reason]
 */
async function triggerRefund(paymentRow, reason = 'Booking cancelled') {
    if (!paymentRow?.razorpay_payment_id) throw new Error('No Razorpay payment ID on record');

    const razorpay = getRazorpay();
    const refund = await razorpay.payments.refund(paymentRow.razorpay_payment_id, {
        amount: paymentRow.amount_paise,
        notes: { reason },
    });

    if (supabase) {
        await supabase.from('payments').update({
            status:               'refunded',
            refund_id:            refund.id,
            refunded_at:          new Date().toISOString(),
            refund_amount_paise:  refund.amount,
            refund_reason:        reason,
        }).eq('id', paymentRow.id);
    }

    return refund;
}

module.exports = { triggerRefund };
