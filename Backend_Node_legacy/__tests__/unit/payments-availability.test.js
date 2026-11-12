/**
 * The booking page pre-selects "Online Payment". On a deployment without Razorpay keys that default produced
 * a booking the owner confirmed and the renter could then never pay for: the Pay Now button answered 503.
 *
 * /bookings/pricing now reports whether online payment can be taken, by this rule, and the page offers only
 * cash on delivery when it cannot. The payment routes apply the same function before calling the gateway.
 */
const { onlinePaymentsAvailable } = require('../../services/payment-service/availability');

describe('online payment availability', () => {
    test('unavailable with no keys', () => {
        expect(onlinePaymentsAvailable({})).toBe(false);
    });

    test('unavailable with only one of the two keys', () => {
        expect(onlinePaymentsAvailable({ RAZORPAY_KEY_ID: 'rzp_live_abc123' })).toBe(false);
        expect(onlinePaymentsAvailable({ RAZORPAY_KEY_SECRET: 'secret' })).toBe(false);
    });

    test('unavailable when the key id is not one Razorpay issues', () => {
        expect(onlinePaymentsAvailable({ RAZORPAY_KEY_ID: 'your-key-here', RAZORPAY_KEY_SECRET: 'secret' })).toBe(false);
    });

    test('empty strings, which is how an unset dashboard variable arrives, count as unset', () => {
        expect(onlinePaymentsAvailable({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' })).toBe(false);
    });

    test.each(['rzp_live_abc123', 'rzp_test_abc123'])('available with both keys and a %s id', (keyId) => {
        expect(onlinePaymentsAvailable({ RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: 'secret' })).toBe(true);
    });

    test('reads the process environment by default', () => {
        const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
        const restore = (name, value) => {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        };
        try {
            delete process.env.RAZORPAY_KEY_ID;
            delete process.env.RAZORPAY_KEY_SECRET;
            expect(onlinePaymentsAvailable()).toBe(false);
            process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
            process.env.RAZORPAY_KEY_SECRET = 'secret';
            expect(onlinePaymentsAvailable()).toBe(true);
        } finally {
            restore('RAZORPAY_KEY_ID', saved.id);
            restore('RAZORPAY_KEY_SECRET', saved.secret);
        }
    });
});
