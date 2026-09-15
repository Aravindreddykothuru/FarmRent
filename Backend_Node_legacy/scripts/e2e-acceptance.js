#!/usr/bin/env node
/**
 * End-to-end acceptance run of the core rental journey against a running FarmRent server.
 *
 *   FARMRENT_ENV_FILE=.env.localstack node scripts/e2e-acceptance.js --base-url http://localhost:3000 --reset-rate-limits
 *
 * Every step issues real HTTP requests (no mocks) and, where the journey makes a claim about stored data
 * (password hashing, a single live booking per slot), reads the database directly.
 *
 * Requirements:
 *   - a server with NODE_ENV != production (registration OTPs are returned in the API response),
 *   - the seeded admin account for the admin steps (npm run seed),
 *   - DATABASE_URL, and REDIS_URL when --reset-rate-limits is used (local stack only: it clears limiter keys).
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({
    path: process.env.FARMRENT_ENV_FILE ? path.resolve(process.env.FARMRENT_ENV_FILE) : path.join(__dirname, '..', '.env'),
});
const { Client } = require('pg');
const { createClient } = require('redis');

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE_URL = option('--base-url', process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const RESET_LIMITS = args.includes('--reset-rate-limits');
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@farmrent.local';
const ADMIN_PASSWORD = process.env.SEED_PASSWORD || 'FarmRent@2026';
const PASSWORD = 'Accept@12345';

const isoDate = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// ── HTTP actor with its own cookie jar ───────────────────────────────────────

class Actor {
    constructor(label) {
        this.label = label;
        this.cookies = new Map();
    }

    storeCookies(res) {
        for (const header of res.headers.getSetCookie()) {
            const [pair, ...attributes] = header.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1);
            const expired = attributes.some((a) => /expires=thu, 01 jan 1970/i.test(a) || /max-age=0\b/i.test(a));
            if (expired || value === '') this.cookies.delete(name);
            else this.cookies.set(name, value);
        }
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
        this.storeCookies(res);
        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch {
            json = null; // HTML page or empty body
        }
        return { status: res.status, headers: res.headers, text, body: json, data: json?.data, error: json?.error };
    }
}

// ── Assertions & reporting ───────────────────────────────────────────────────

function check(condition, message) {
    if (!condition) throw new Error(message);
}

function expectStatus(res, expected, what) {
    const allowed = Array.isArray(expected) ? expected : [expected];
    check(allowed.includes(res.status), `${what}: expected HTTP ${allowed.join('/')}, got ${res.status} ${(res.text || '').slice(0, 300)}`);
    return res;
}

const results = [];
async function step(id, title, fn) {
    const started = Date.now();
    try {
        const evidence = await fn();
        results.push({ id, title, ok: true });
        console.log(`PASS  ${id.padEnd(5)} ${title}  (${Date.now() - started} ms)`);
        for (const line of [].concat(evidence || [])) console.log(`        ${line}`);
    } catch (err) {
        results.push({ id, title, ok: false });
        console.log(`FAIL  ${id.padEnd(5)} ${title}\n        ${err.message}`);
        throw err;
    }
}

async function withDb(fn) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.end();
    }
}

async function resetRateLimits() {
    if (!RESET_LIMITS) return;
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    try {
        for (const pattern of ['rate_limit:*', 'rl:*', 'login_fail:*', 'lock:*']) {
            for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
                const batch = Array.isArray(keys) ? keys : [keys];
                if (batch.length) await client.del(batch);
            }
        }
    } finally {
        await client.quit();
    }
}

async function register(actor, role, name) {
    const email = `e2e.${role}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}@farmrent.test`;
    const phone = `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;

    const availability = expectStatus(
        await actor.call('GET', `/api/v1/auth/check-availability?email=${encodeURIComponent(email)}`),
        200,
        'email availability',
    );
    check(availability.data.emailTaken === false, 'a brand-new email was reported as taken');

    const sent = expectStatus(await actor.call('POST', '/api/v1/auth/reg-email-send-otp', { email }), 200, 'send registration OTP');
    check(/^\d{6}$/.test(sent.data?.devOtp || ''), 'no development OTP in the response — run the server with NODE_ENV=development');
    expectStatus(
        await actor.call('POST', '/api/v1/auth/reg-email-verify-otp', { email, otp: sent.data.devOtp }),
        200,
        'verify registration OTP',
    );

    const res = expectStatus(
        await actor.call('POST', '/api/v1/auth/register', {
            email,
            password: PASSWORD,
            name,
            phone,
            role,
            district: 'Anantapur',
            state: 'Andhra Pradesh',
        }),
        201,
        `register ${role}`,
    );
    return { email, phone, id: res.data.user.id, role: res.data.user.role };
}

async function login(actor, email, password) {
    const res = expectStatus(await actor.call('POST', '/api/v1/auth/login', { email, password }), 200, `login ${email}`);
    check(actor.cookies.has('token') && actor.cookies.has('rfsh'), 'login did not set the token and refresh cookies');
    return res.data.user;
}

// ── The journey ──────────────────────────────────────────────────────────────

async function main() {
    console.log(`FarmRent acceptance run against ${BASE_URL}\n`);
    const renter = new Actor('renter');
    const owner = new Actor('owner');
    const secondRenter = new Actor('second renter');
    const admin = new Actor('admin');
    const state = {};

    await step('1', 'Full stack is up: API, database and web app respond', async () => {
        const health = expectStatus(await renter.call('GET', '/health/full'), 200, 'readiness');
        check(health.body.dependencies.database.reachable === true, 'database not reachable');
        const home = expectStatus(await renter.call('GET', '/'), 200, 'home page');
        state.hasWebApp = /<html/i.test(home.text);
        check(state.hasWebApp, 'GET / did not return the web app');
        return [
            `database latency ${health.body.dependencies.database.latencyMs} ms, redis ready=${health.body.dependencies.redis.isReady}`,
        ];
    });

    await step('2', 'Web app initial load renders a real page (no error page, assets referenced)', async () => {
        const home = await renter.call('GET', '/');
        check(/_next\/static/.test(home.text), 'no Next.js assets referenced');
        check(!/Application error|Internal Server Error/i.test(home.text), 'error page rendered');
        const login = expectStatus(await renter.call('GET', '/login'), 200, 'login page');
        check(/<form|type="password"/i.test(login.text), 'login page has no form');
        return ['browser console checks: nextfrontend/scripts/ui-smoke.mjs (npm run ui:smoke)'];
    });

    await resetRateLimits();
    await step('3', 'Register a renter; row created and password stored as a bcrypt hash', async () => {
        state.renter = await register(renter, 'farmer', 'E2E Renter');
        const { rows } = await withDb((db) =>
            db.query(
                `SELECT u.password_hash, r.name AS role FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.email = $1`,
                [state.renter.email],
            ),
        );
        check(rows.length === 1, 'user row (with role) not found');
        check(/^\$2[aby]\$12\$/.test(rows[0].password_hash) && !rows[0].password_hash.includes(PASSWORD), 'password is not a bcrypt hash');
        return [`user ${state.renter.id} role=${rows[0].role} hash=${rows[0].password_hash.slice(0, 7)}…`];
    });

    await step('4', 'Renter logs in; session survives a reload and the refresh token rotates', async () => {
        renter.cookies.clear();
        await login(renter, state.renter.email, PASSWORD);
        const me1 = expectStatus(await renter.call('GET', '/api/v1/auth/me'), 200, 'me');
        const me2 = expectStatus(await renter.call('GET', '/api/v1/auth/me'), 200, 'me after reload');
        check(me1.data.user.id === state.renter.id && me2.data.user.id === state.renter.id, 'session user mismatch');
        const oldRefresh = renter.cookies.get('rfsh');
        expectStatus(await renter.call('POST', '/api/v1/auth/refresh'), 200, 'refresh');
        check(renter.cookies.get('rfsh') !== oldRefresh, 'refresh token was not rotated');
        expectStatus(await renter.call('GET', '/api/v1/auth/me'), 200, 'me with refreshed token');
        state.renterAccessToken = renter.cookies.get('token');
        return ['token cookie httpOnly session; refresh rotated'];
    });

    await resetRateLimits();
    await step('5', 'Register an equipment owner (logged in on registration)', async () => {
        state.owner = await register(owner, 'owner', 'E2E Owner');
        const me = expectStatus(await owner.call('GET', '/api/v1/auth/me'), 200, 'owner me');
        check(me.data.user.role === 'owner', `expected owner role, got ${me.data.user.role}`);
        return [`owner ${state.owner.id}`];
    });

    await step('6', 'Owner creates a listing with price, location and pickup point', async () => {
        state.tag = `E2E${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const res = expectStatus(
            await owner.call('POST', '/api/v1/machines', {
                name: `Acceptance Tractor ${state.tag}`,
                type: 'tractor',
                description: 'Listing created by the acceptance run',
                pricing: { baseRatePerDay: 1200, securityDeposit: 800 },
                location: {
                    village: 'Rampur',
                    district: 'Anantapur',
                    state: 'Andhra Pradesh',
                    pincode: '515001',
                    coordinates: { type: 'Point', coordinates: [77.6006, 14.6819] },
                },
                pickup_lat: 14.682,
                pickup_lng: 77.601,
                pickup_address: 'Owner yard near the grain market',
            }),
            201,
            'create listing',
        );
        state.machineId = res.data.id;
        check(res.data.status === 'available' && res.data.pricing.baseRatePerDay === 1200, 'listing not stored as available at ₹1200/day');
        return [`machine ${state.machineId}`];
    });

    await step('7', 'Renter finds the listing through browse and search', async () => {
        const list = expectStatus(await renter.call('GET', `/api/v1/machines?q=${state.tag}`), 200, 'browse');
        check(
            list.data.some((m) => m.id === state.machineId),
            'listing missing from browse results',
        );
        const search = expectStatus(await renter.call('GET', `/api/v1/search/machines?district=Anantapur&q=${state.tag}`), 200, 'search');
        check(
            search.data.machines.some((m) => m.id === state.machineId),
            'listing missing from district search',
        );
        return [`browse hits=${list.data.length}, search hits=${search.data.machines.length}`];
    });

    await step('8', 'Detail page data: price and availability match what the owner set', async () => {
        const detail = expectStatus(await renter.call('GET', `/api/v1/machines/${state.machineId}`), 200, 'detail');
        check(detail.data.pricing.baseRatePerDay === 1200 && detail.data.pricing.securityDeposit === 800, 'price/deposit mismatch');
        check(!('pickup' in detail.data), 'pickup point exposed before booking');
        const availability = expectStatus(
            await renter.call('GET', `/api/v1/bookings/availability/${state.machineId}`),
            200,
            'availability',
        );
        check(Array.isArray(availability.data) && availability.data.length === 0, 'new listing should have no booked ranges');
        state.dates = [isoDate(20), isoDate(22)];
        const quote = expectStatus(
            await renter.call(
                'GET',
                `/api/v1/bookings/quote?equipment_id=${state.machineId}&start_date=${state.dates[0]}&end_date=${state.dates[1]}`,
            ),
            200,
            'quote',
        );
        check(quote.data.available && quote.data.total === 3600 + 108 + 800, `unexpected quote ${JSON.stringify(quote.data)}`);
        state.quoteTotal = quote.data.total;
        return [`3 days × ₹1200 + ₹108 fee + ₹800 deposit = ₹${quote.data.total}`];
    });

    await step('9', 'Renter requests the dates; request stored and visible to the owner', async () => {
        const res = expectStatus(
            await renter.call('POST', '/api/v1/bookings', {
                machineId: state.machineId,
                startDate: state.dates[0],
                endDate: state.dates[1],
                paymentMethod: 'cod',
                totalAmount: 1,
            }),
            201,
            'create booking',
        );
        state.bookingId = res.data.id;
        check(
            res.data.status === 'pending' && res.data.total_amount === state.quoteTotal,
            'booking not pending at the quoted server price',
        );
        const incoming = expectStatus(await owner.call('GET', '/api/v1/bookings/incoming?status=pending'), 200, 'owner incoming');
        check(
            incoming.data.bookings.some((b) => b.id === state.bookingId),
            'owner cannot see the request',
        );
        const { rows } = await withDb((db) =>
            db.query('SELECT status, total_amount FROM equipment_rentals WHERE id = $1', [state.bookingId]),
        );
        check(rows[0]?.status === 'requested', 'database row not in requested state');
        return [`booking ${state.bookingId} total ₹${res.data.total_amount} (client sent ₹1, ignored)`];
    });

    await resetRateLimits();
    await step('10', 'An overlapping request for the same equipment is rejected by the server', async () => {
        state.secondRenter = await register(secondRenter, 'farmer', 'E2E Second Renter');
        const res = expectStatus(
            await secondRenter.call('POST', '/api/v1/bookings', {
                machineId: state.machineId,
                startDate: state.dates[1],
                endDate: isoDate(24),
                paymentMethod: 'cod',
            }),
            409,
            'overlapping booking',
        );
        check(res.error.code === 'BOOKING_CONFLICT', `expected BOOKING_CONFLICT, got ${res.error.code}`);
        const { rows } = await withDb((db) =>
            db.query(
                `SELECT count(*)::int AS n FROM equipment_rentals WHERE equipment_id = $1 AND status IN ('requested','approved','active','return_pending')`,
                [state.machineId],
            ),
        );
        check(rows[0].n === 1, `expected exactly one live booking, found ${rows[0].n}`);
        return ['409 BOOKING_CONFLICT; one live booking in the database'];
    });

    await step('11', 'Owner confirms; both sides see the new status', async () => {
        const renterTry = expectStatus(await renter.call('PATCH', `/api/v1/bookings/${state.bookingId}/accept`), 403, 'renter accepting');
        check(renterTry.error.code === 'FORBIDDEN', 'renter was not forbidden');
        const accepted = expectStatus(await owner.call('PATCH', `/api/v1/bookings/${state.bookingId}/accept`), 200, 'owner accept');
        check(accepted.data.status === 'confirmed', 'owner did not see confirmed');
        const renterView = expectStatus(await renter.call('GET', `/api/v1/bookings/${state.bookingId}`), 200, 'renter view');
        check(
            renterView.data.status === 'confirmed' && renterView.data.pickup?.address,
            'renter does not see confirmation and pickup point',
        );
        return ['renter sees confirmed + pickup point'];
    });

    await step('12', "Rental runs to completion: hand-over → return → owner completes with the renter's code", async () => {
        expectStatus(
            await renter.call('POST', `/api/v1/bookings/${state.bookingId}/complete`, { otp: '000000' }),
            403,
            'renter completing',
        );
        const started = expectStatus(await owner.call('PATCH', `/api/v1/bookings/${state.bookingId}/start`), 200, 'hand over');
        check(started.data.status === 'in_progress', 'not in progress after hand-over');
        const returning = expectStatus(await renter.call('POST', `/api/v1/bookings/${state.bookingId}/return`), 200, 'return');
        check(returning.data.status === 'return_pending' && /^\d{6}$/.test(returning.data.completion_otp), 'no completion code on return');
        expectStatus(
            await owner.call('POST', `/api/v1/bookings/${state.bookingId}/complete`, {
                otp: returning.data.completion_otp === '123456' ? '654321' : '123456',
            }),
            400,
            'wrong code',
        );
        const done = expectStatus(
            await owner.call('POST', `/api/v1/bookings/${state.bookingId}/complete`, { otp: returning.data.completion_otp }),
            200,
            'complete',
        );
        check(done.data.status === 'completed', 'not completed');
        const renterView = expectStatus(await renter.call('GET', `/api/v1/bookings/${state.bookingId}`), 200, 'renter view');
        check(renterView.data.status === 'completed', 'renter does not see completed');
        return ['confirmed → in_progress → return_pending → completed'];
    });

    await step('13', 'Rental history is correct and scoped to each role', async () => {
        const renterHistory = expectStatus(await renter.call('GET', '/api/v1/bookings/my?status=all'), 200, 'renter history');
        check(
            renterHistory.data.bookings.some((b) => b.id === state.bookingId && b.status === 'completed'),
            'renter history missing completed booking',
        );
        const ownerAsRenter = expectStatus(await owner.call('GET', '/api/v1/bookings/my?status=all'), 200, 'owner renter-history');
        check(!ownerAsRenter.data.bookings.some((b) => b.id === state.bookingId), 'owner sees the booking as their own rental');
        const ownerIncoming = expectStatus(await owner.call('GET', '/api/v1/bookings/incoming?status=completed'), 200, 'owner history');
        check(
            ownerIncoming.data.bookings.some((b) => b.id === state.bookingId),
            'owner history missing booking',
        );
        expectStatus(await secondRenter.call('GET', `/api/v1/bookings/${state.bookingId}`), 404, 'other renter viewing');
        return ['renter: in /my; owner: in /incoming only; unrelated user: 404'];
    });

    await resetRateLimits();
    await step('14', 'Logout: protected API calls and pages are denied afterwards', async () => {
        const oldToken = renter.cookies.get('token');
        expectStatus(await renter.call('POST', '/api/v1/auth/logout'), 200, 'logout');
        check(!renter.cookies.has('token'), 'token cookie not cleared');
        expectStatus(await renter.call('GET', '/api/v1/auth/me'), 401, 'me after logout');
        expectStatus(await renter.call('GET', '/api/v1/bookings/my'), 401, 'bookings after logout');
        expectStatus(
            await new Actor('replay').call('GET', '/api/v1/bookings/my', undefined, { Authorization: `Bearer ${oldToken}` }),
            401,
            'old token replay',
        );
        const page = await renter.call('GET', '/dashboard/farmer');
        check(
            [307, 308].includes(page.status) && /\/login/.test(page.headers.get('location') || ''),
            `protected page not redirected to login (HTTP ${page.status})`,
        );
        return ['401 on API, 307 → /login on the dashboard, revoked token rejected'];
    });

    await resetRateLimits();
    await step('15', 'Admin workflow: dashboard, users, listing moderation; non-admins refused', async () => {
        await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
        const dashboard = expectStatus(await admin.call('GET', '/api/v1/admin/dashboard'), 200, 'admin dashboard');
        const totals = dashboard.data.overview;
        check(totals.totalBookings >= 1 && totals.totalUsers >= 3 && totals.totalMachines >= 1, 'admin totals look wrong');
        const users = expectStatus(await admin.call('GET', '/api/v1/admin/users'), 200, 'admin users');
        check(
            users.data.some((u) => u.id === state.owner.id && u.role === 'owner'),
            'owner missing from admin user list',
        );
        expectStatus(await admin.call('PATCH', `/api/v1/admin/machines/${state.machineId}/approve`), 200, 'approve listing');
        const bookings = expectStatus(await admin.call('GET', '/api/v1/admin/bookings'), 200, 'admin bookings');
        check(
            bookings.data.some((b) => b.id === state.bookingId),
            'booking missing from admin view',
        );
        expectStatus(await owner.call('GET', '/api/v1/admin/users'), 403, 'owner reading admin users');
        expectStatus(await admin.call('POST', '/api/v1/auth/logout'), 200, 'admin logout');
        expectStatus(await admin.call('GET', '/api/v1/admin/dashboard'), 401, 'admin dashboard after logout');
        return [`totals: users=${totals.totalUsers}, bookings=${totals.totalBookings}, machines=${totals.totalMachines}`];
    });
}

main()
    .catch(() => {
        /* already reported by step() */
    })
    .finally(() => {
        const passed = results.filter((r) => r.ok).length;
        console.log(`\n${passed}/${results.length} steps passed${results.length < 15 ? ' (run stopped at the first failure)' : ''}`);
        process.exit(passed === 15 ? 0 : 1);
    });
