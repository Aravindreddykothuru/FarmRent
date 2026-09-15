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
 * @param {{ id: string, gateway_payment_id: string, amount: number, razorpay_payment_id?: string, amount_paise?: number }} paymentRow
 * @param {string} [reason]
 */
async function triggerRefund(paymentRow, reason = 'Booking cancelled') {
    const paymentId = paymentRow?.gateway_payment_id || paymentRow?.razorpay_payment_id;
    if (!paymentId) throw new Error('No Razorpay payment ID on record');

    const razorpay = getRazorpay();
    const amountInr = paymentRow.amount || (paymentRow.amount_paise ? paymentRow.amount_paise / 100 : 0);
    const amountPaise = Math.round(amountInr * 100);

    const refund = await razorpay.payments.refund(paymentId, {
        amount: amountPaise,
        notes: { reason },
    });

    if (supabase) {
        await supabase
            .from('payments')
            .update({
                status: 'refunded',
                refund_amount: Number(refund.amount) / 100, // store in INR
                metadata: {
                    refund_id: refund.id,
                    refund_reason: reason,
                    refunded_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
            })
            .eq('id', paymentRow.id);
    }

    return refund;
}

module.exports = { triggerRefund };
