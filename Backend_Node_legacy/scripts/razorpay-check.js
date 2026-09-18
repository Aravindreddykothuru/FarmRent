#!/usr/bin/env node
/**
 * Razorpay integration check against the real gateway, in test mode.
 *
 *   FARMRENT_ENV_FILE=<env with rzp_test_ keys> node scripts/razorpay-check.js --base-url http://localhost:3000
 *
 * The API's own payment tests never touch the network (__tests__/integration/payments.test.js). This script is
 * the other half: it proves the order really is created at Razorpay, by creating one through the API and then
 * reading it back from api.razorpay.com with the account's own credentials.
 *
 * Razorpay cannot reach a laptop, so the capture and failure events are posted here, signed with
 * RAZORPAY_WEBHOOK_SECRET exactly as Razorpay signs them — the signature is what the API trusts, not the
 * source address. Completing a card payment in the hosted checkout is a browser journey and is not attempted.
 *
 * Requirements: a running server on --base-url started with the same env file, the seeded demo accounts
 * (npm run seed), and RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET set.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({
    path: process.env.FARMRENT_ENV_FILE ? path.resolve(process.env.FARMRENT_ENV_FILE) : path.join(__dirname, '..', '.env'),
});

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE_URL = option('--base-url', process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.SEED_PASSWORD || 'FarmRent@2026';
const RENTER = option('--renter', 'farmer1@farmrent.local');
const OWNER = option('--owner', 'owner2@farmrent.local');
const EQUIPMENT = option('--equipment', '5b6d8c1e-0001-4a3b-9c2d-000000000005'); // seeded, owned by owner2

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

const isoDate = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

class Actor {
    constructor(label) {
        this.label = label;
        this.cookies = new Map();
    }

    async call(method, urlPath, body, headers = {}) {
        const res = await fetch(`${BASE_URL}${urlPath}`, {
            method,
            redirect: 'manual',
            headers: {
                ...(body !== undefined && { 'Content-Type': 'application/json' }),
                ...(this.cookies.size && { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        for (const header of res.headers.getSetCookie()) {
            const [pair] = header.split(';');
            const eq = pair.indexOf('=');
            this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
        }
        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }
        return { status: res.status, text, body: json, data: json?.data, error: json?.error };
    }
}

const results = [];
function check(condition, message) {
    if (!condition) throw new Error(message);
}

function expectStatus(res, expected, what) {
    const allowed = Array.isArray(expected) ? expected : [expected];
    check(allowed.includes(res.status), `${what}: expected HTTP ${allowed.join('/')}, got ${res.status} ${(res.text || '').slice(0, 300)}`);
    return res;
}

async function step(id, title, fn) {
    const started = Date.now();
    try {
        const evidence = await fn();
        results.push({ id, ok: true });
        console.log(`PASS  ${id.padEnd(4)} ${title}  (${Date.now() - started} ms)`);
        for (const line of [].concat(evidence || [])) console.log(`        ${line}`);
    } catch (err) {
        results.push({ id, ok: false });
        console.log(`FAIL  ${id.padEnd(4)} ${title}\n        ${err.message}`);
        throw err;
    }
}

const login = async (actor, email) =>
    expectStatus(await actor.call('POST', '/api/v1/auth/login', { email, password: PASSWORD }), 200, `login ${email}`);

/** A confirmed online booking: the state in which a renter may pay. */
async function confirmedOnlineBooking(renter, owner, offset) {
    const created = expectStatus(
        await renter.call('POST', '/api/v1/bookings', {
            machineId: EQUIPMENT,
            startDate: isoDate(offset),
            endDate: isoDate(offset),
            paymentMethod: 'razorpay',
        }),
        201,
        'create booking',
    );
    expectStatus(await owner.call('PATCH', `/api/v1/bookings/${created.data.id}/accept`), 200, 'owner confirms');
    return created.data;
}

const postWebhook = async (event) => {
    const raw = Buffer.from(JSON.stringify(event));
    const res = await fetch(`${BASE_URL}/api/payment/webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
        },
        body: raw,
    });
    return { status: res.status, text: await res.text() };
};

async function waitForPaymentStatus(actor, bookingId, wanted, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let seen = null;
    while (Date.now() < deadline) {
        const res = await actor.call('GET', `/api/v1/bookings/${bookingId}`);
        seen = res.data?.paymentStatus;
        if (seen === wanted) return seen;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return seen;
}

async function main() {
    console.log(`Razorpay test-mode check against ${BASE_URL}\n`);
    check(KEY_ID && KEY_SECRET, 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set for this check');
    check(KEY_ID.startsWith('rzp_test_'), 'refusing to run against a live key — use rzp_test_ credentials');
    check(WEBHOOK_SECRET, 'RAZORPAY_WEBHOOK_SECRET must be set for the webhook half of this check');

    const renter = new Actor('renter');
    const owner = new Actor('owner');
    let paidBooking;
    let failedBooking;
    let orderId;

    await step('1', 'Seeded renter and owner sign in', async () => {
        await login(renter, RENTER);
        await login(owner, OWNER);
        return [`${RENTER} and ${OWNER}`];
    });

    await step('2', 'A pending request cannot be paid for', async () => {
        const created = expectStatus(
            await renter.call('POST', '/api/v1/bookings', {
                machineId: EQUIPMENT,
                startDate: isoDate(400),
                endDate: isoDate(400),
                paymentMethod: 'razorpay',
            }),
            201,
            'create booking',
        );
        const refused = expectStatus(
            await renter.call(
                'POST',
                '/api/payment/create-order',
                { bookingId: created.data.id },
                { 'Idempotency-Key': `check-${crypto.randomUUID()}` },
            ),
            409,
            'create-order before confirmation',
        );
        check(refused.error.code === 'BOOKING_NOT_PAYABLE', `expected BOOKING_NOT_PAYABLE, got ${refused.error.code}`);
        expectStatus(await renter.call('PATCH', `/api/v1/bookings/${created.data.id}/cancel`), 200, 'tidy up');
        return ['409 BOOKING_NOT_PAYABLE while the owner has not confirmed'];
    });

    await step('3', 'A confirmed booking creates a real order at Razorpay', async () => {
        paidBooking = await confirmedOnlineBooking(renter, owner, 401);
        const order = expectStatus(
            await renter.call(
                'POST',
                '/api/payment/create-order',
                { bookingId: paidBooking.id },
                { 'Idempotency-Key': `check-${crypto.randomUUID()}` },
            ),
            200,
            'create-order',
        );
        orderId = order.body.orderId || order.data?.orderId;
        check(/^order_/.test(orderId || ''), `no Razorpay order id in the response: ${order.text.slice(0, 200)}`);

        // Read the order back from Razorpay itself — proof the API really created it there.
        const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
        const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, { headers: { Authorization: `Basic ${auth}` } });
        check(res.status === 200, `Razorpay did not return the order (HTTP ${res.status})`);
        const remote = await res.json();
        const expectedPaise = Math.round(Number(paidBooking.totalAmount ?? paidBooking.total_amount) * 100);
        check(remote.amount === expectedPaise, `order amount ${remote.amount} does not match the booking ${expectedPaise}`);
        check(remote.receipt === paidBooking.id, `order receipt ${remote.receipt} is not the booking id`);
        return [`order ${orderId} exists at Razorpay for ₹${(remote.amount / 100).toFixed(2)}, status ${remote.status}`];
    });

    await step('4', 'A captured payment marks the booking paid and releases the hand-over', async () => {
        const event = {
            event: 'payment.captured',
            payload: {
                payment: {
                    entity: {
                        id: `pay_${crypto.randomBytes(7).toString('hex')}`,
                        order_id: orderId,
                        amount: Math.round(Number(paidBooking.totalAmount ?? paidBooking.total_amount) * 100),
                        currency: 'INR',
                    },
                },
            },
        };
        const res = await postWebhook(event);
        check(res.status === 200, `webhook rejected: HTTP ${res.status} ${res.text.slice(0, 200)}`);

        const status = await waitForPaymentStatus(renter, paidBooking.id, 'paid');
        check(status === 'paid', `booking payment status is ${status}, expected paid`);
        expectStatus(await owner.call('PATCH', `/api/v1/bookings/${paidBooking.id}/start`), 200, 'hand over a paid booking');
        return [`booking ${paidBooking.id} is paid; hand-over accepted`];
    });

    await step('5', 'A failed payment leaves the booking unpaid and undeliverable', async () => {
        failedBooking = await confirmedOnlineBooking(renter, owner, 402);
        const order = expectStatus(
            await renter.call(
                'POST',
                '/api/payment/create-order',
                { bookingId: failedBooking.id },
                { 'Idempotency-Key': `check-${crypto.randomUUID()}` },
            ),
            200,
            'create-order',
        );
        const failedOrderId = order.body.orderId || order.data?.orderId;

        const res = await postWebhook({
            event: 'payment.failed',
            payload: {
                payment: {
                    entity: {
                        id: `pay_${crypto.randomBytes(7).toString('hex')}`,
                        order_id: failedOrderId,
                        error_description: 'Card declined by the issuing bank',
                    },
                },
            },
        });
        check(res.status === 200, `webhook rejected: HTTP ${res.status}`);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        const view = expectStatus(await renter.call('GET', `/api/v1/bookings/${failedBooking.id}`), 200, 'booking after failure');
        check(view.data.paymentStatus !== 'paid', `a failed payment left the booking ${view.data.paymentStatus}`);
        check(view.data.status === 'confirmed', `a failed payment moved the booking to ${view.data.status}`);

        const refused = expectStatus(
            await owner.call('PATCH', `/api/v1/bookings/${failedBooking.id}/start`),
            409,
            'hand over an unpaid booking',
        );
        check(refused.error.code === 'PAYMENT_REQUIRED', `expected PAYMENT_REQUIRED, got ${refused.error.code}`);
        return [`order ${failedOrderId} failed; booking still ${view.data.paymentStatus}, hand-over refused`];
    });

    await step('6', 'A forged webhook changes nothing', async () => {
        const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { order_id: orderId } } } }));
        const res = await fetch(`${BASE_URL}/api/payment/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
            body: raw,
        });
        check(res.status === 400, `a forged signature was accepted (HTTP ${res.status})`);
        return ['400 on an invalid signature'];
    });
}

main()
    .catch(() => {
        /* already reported by step() */
    })
    .finally(() => {
        const passed = results.filter((r) => r.ok).length;
        console.log(`\n${passed}/${results.length} checks passed${results.length < 6 ? ' (stopped at the first failure)' : ''}`);
        process.exit(passed === 6 ? 0 : 1);
    });
