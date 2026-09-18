/**
 * Razorpay webhooks — the only message that moves a booking to paid without the renter's browser.
 *
 * The gateway cannot reach a laptop, so these tests post the events themselves, signed the way Razorpay signs
 * them. What is checked is what the money depends on: an event the API cannot prove came from Razorpay changes
 * nothing, a captured payment marks the booking paid, and a failed payment leaves it unpaid — and therefore
 * undeliverable, because hand-over refuses an unpaid online booking.
 *
 * The live gateway itself (a real order created with test keys) is covered by scripts/razorpay-check.js, which
 * needs real credentials and so cannot run in this suite.
 */
const crypto = require('crypto');
const request = require('supertest');
const { getApp, resetRateLimits, isoDate, createUser, login, createEquipment, withDb } = require('./helpers');

const WEBHOOK_SECRET = 'whsec_test_only_0123456789abcdef';
const sign = (raw) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');

/**
 * Posts a webhook exactly as Razorpay does: the raw JSON body plus a signature over those same bytes.
 * The body is sent as a string, not a Buffer — superagent re-serialises a Buffer under a JSON content type,
 * which would mean signing one payload and delivering another.
 */
function postWebhook(event, { signature } = {}) {
    const raw = JSON.stringify(event);
    return request(getApp())
        .post('/api/payment/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature === undefined ? sign(raw) : signature)
        .send(raw);
}

const capturedEvent = (orderId, amountPaise) => ({
    event: 'payment.captured',
    payload: {
        payment: {
            entity: { id: `pay_${crypto.randomBytes(7).toString('hex')}`, order_id: orderId, amount: amountPaise, currency: 'INR' },
        },
    },
});

const failedEvent = (orderId) => ({
    event: 'payment.failed',
    payload: {
        payment: {
            entity: {
                id: `pay_${crypto.randomBytes(7).toString('hex')}`,
                order_id: orderId,
                error_description: 'Card declined by the issuing bank',
            },
        },
    },
});

/** The webhook answers 200 before doing the work, so read the result back until it lands. */
async function waitFor(read, matches, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
        last = await read();
        if (matches(last)) return last;
        if (Date.now() > deadline) return last;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

const bookingRow = (id) =>
    withDb((db) => db.query('SELECT status, payment_status FROM equipment_rentals WHERE id = $1', [id])).then((r) => r.rows[0]);
const paymentRow = (orderId) =>
    withDb((db) => db.query('SELECT status, failure_reason FROM payments WHERE gateway_order_id = $1', [orderId])).then((r) => r.rows[0]);

describe('razorpay webhooks', () => {
    let previousSecret;

    beforeAll(() => {
        previousSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    });

    afterAll(() => {
        if (previousSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
        else process.env.RAZORPAY_WEBHOOK_SECRET = previousSecret;
    });

    beforeEach(() => resetRateLimits());

    /** A confirmed online booking with an open order, the state a renter is in while the checkout is open. */
    async function bookingAwaitingPayment() {
        const owner = await createUser('owner');
        const renter = await createUser('farmer');
        const equipmentId = await createEquipment(owner.id, { dailyRate: 900, deposit: 0 });
        const [ownerAgent, renterAgent] = await Promise.all([login(owner), login(renter)]);
        const offset = 300 + Math.floor(Math.random() * 300);
        const booking = (
            await renterAgent
                .post('/api/v1/bookings')
                .send({ machineId: equipmentId, startDate: isoDate(offset), endDate: isoDate(offset), paymentMethod: 'razorpay' })
                .expect(201)
        ).body.data;
        await ownerAgent.patch(`/api/v1/bookings/${booking.id}/accept`).expect(200);

        const orderId = `order_${crypto.randomBytes(7).toString('hex')}`;
        await withDb((db) =>
            db.query(
                `INSERT INTO payments (payer_id, payee_id, reference_id, reference_type, gateway_order_id, amount, currency, status,
                                       idempotency_key)
                 VALUES ($1, $2, $3, 'rental', $4, $5, 'INR', 'created', $6)`,
                [renter.id, owner.id, booking.id, orderId, booking.total_amount, `order_${orderId}`],
            ),
        );
        return { booking, orderId, ownerAgent, renterAgent, amountPaise: Math.round(Number(booking.total_amount) * 100) };
    }

    test('an event the API cannot prove came from Razorpay changes nothing', async () => {
        const { booking, orderId, amountPaise } = await bookingAwaitingPayment();

        const forged = await postWebhook(capturedEvent(orderId, amountPaise), { signature: 'deadbeef' });
        expect(forged.status).toBe(400);
        await postWebhook(capturedEvent(orderId, amountPaise), { signature: '' }).expect(400);

        // Give the handler the same window a real event would have had, then confirm nothing moved.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect((await bookingRow(booking.id)).payment_status).toBe('pending');
        expect((await paymentRow(orderId)).status).toBe('created');
    });

    test('a captured payment marks the booking paid and lets the owner hand the equipment over', async () => {
        const { booking, orderId, ownerAgent, amountPaise } = await bookingAwaitingPayment();

        await postWebhook(capturedEvent(orderId, amountPaise)).expect(200);

        expect(
            (
                await waitFor(
                    () => paymentRow(orderId),
                    (row) => row.status === 'captured',
                )
            ).status,
        ).toBe('captured');
        expect(
            (
                await waitFor(
                    () => bookingRow(booking.id),
                    (row) => row.payment_status === 'paid',
                )
            ).payment_status,
        ).toBe('paid');

        const started = await ownerAgent.patch(`/api/v1/bookings/${booking.id}/start`).expect(200);
        expect(started.body.data.status).toBe('in_progress');
    });

    test('a failed payment leaves the booking unpaid, and the equipment is not handed over', async () => {
        const { booking, orderId, ownerAgent } = await bookingAwaitingPayment();

        await postWebhook(failedEvent(orderId)).expect(200);

        const payment = await waitFor(
            () => paymentRow(orderId),
            (row) => row.status === 'failed',
        );
        expect(payment.status).toBe('failed');
        expect(payment.failure_reason).toMatch(/declined/i);

        const after = await bookingRow(booking.id);
        expect(after.payment_status).toBe('pending');
        expect(after.status).toBe('approved'); // still confirmed, but not started

        const refused = await ownerAgent.patch(`/api/v1/bookings/${booking.id}/start`).expect(409);
        expect(refused.body.error.code).toBe('PAYMENT_REQUIRED');
    });

    test('webhooks are refused outright when no signing secret is configured', async () => {
        const configured = process.env.RAZORPAY_WEBHOOK_SECRET;
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
        try {
            const res = await postWebhook(capturedEvent('order_unconfigured', 100000));
            expect(res.status).toBe(503);
        } finally {
            process.env.RAZORPAY_WEBHOOK_SECRET = configured;
        }
    });
});
