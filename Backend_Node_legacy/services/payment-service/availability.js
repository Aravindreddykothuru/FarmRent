/**
 * Whether online payment can actually be taken: both Razorpay keys are set and the key id is one Razorpay
 * issues. The same rule the payment routes apply before calling the gateway, in one place so that what the
 * booking page offers and what the payment endpoint accepts cannot disagree.
 */
function onlinePaymentsAvailable(env = process.env) {
    const keyId = env.RAZORPAY_KEY_ID;
    const keySecret = env.RAZORPAY_KEY_SECRET;
    return Boolean(keyId && keySecret && /^rzp_(live|test)_/.test(keyId));
}

module.exports = { onlinePaymentsAvailable };
