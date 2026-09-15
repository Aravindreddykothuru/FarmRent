/**
 * API contract sweep: every route mounted on the Express app is called at least once with a well-formed
 * request and once with a malformed or unauthorised one, and the status (and error code where it matters)
 * is asserted. The last test fails if a mounted route has no contract check here, so new endpoints cannot
 * ship without one.
 *
 * Endpoints backed by services absent from the local stack (Razorpay, the Flask ML sidecar, Google OAuth)
 * are asserted to fail cleanly with 503 rather than being skipped.
 */
const request = require('supertest');
const { getApp, resetRateLimits, isoDate, createUser, login, createEquipment, withDb, uniqueEmail, randomPhone } = require('./helpers');

// Smallest valid PNG (1×1) — passes the magic-number checks on upload routes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NIL_UUID = '00000000-0000-4000-8000-000000000000';

const covered = new Set();
const anon = () => request(getApp());

/** Records the route and asserts status (and optionally error code). Returns the parsed envelope data. */
async function check(route, call, status, code) {
    covered.add(route);
    const res = await call;
    const expected = Array.isArray(status) ? status : [status];
    if (!expected.includes(res.status)) {
        throw new Error(`${route}: expected ${expected.join('/')} got ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
    }
    if (code) expect(res.body.error?.code).toBe(code);
    return res.body?.data;
}

function mountedRoutes() {
    const routes = new Set();
    const mountPath = (layer) => {
        let s = layer.regexp.source;
        if (s.startsWith('^')) s = s.slice(1);
        const cut = s.indexOf('\\/?(?=');
        if (cut !== -1) s = s.slice(0, cut);
        return s.replace(/\\\//g, '/').replace(/\\$/, '');
    };
    (function walk(stack, prefix) {
        for (const layer of stack) {
            if (layer.route) {
                const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
                for (const p of paths) {
                    for (const method of Object.keys(layer.route.methods)) {
                        const full = `${prefix}${p === '/' && prefix ? '' : p}`.replace(/\/$/, '') || '/';
                        routes.add(`${method.toUpperCase()} ${full}`);
                    }
                }
            } else if (layer.name === 'router' && layer.handle.stack) {
                walk(layer.handle.stack, prefix + mountPath(layer));
            }
        }
    })(getApp()._router.stack, '');
    return routes;
}

describe('API contract — every mounted route', () => {
    const ctx = {};

    beforeAll(async () => {
        await resetRateLimits();
        ctx.owner = await createUser('owner', 'Contract Owner');
        ctx.renter = await createUser('farmer', 'Contract Renter');
        ctx.stranger = await createUser('farmer', 'Contract Stranger');
        ctx.admin = await createUser('admin', 'Contract Admin');
        [ctx.ownerAgent, ctx.renterAgent, ctx.strangerAgent, ctx.adminAgent] = await Promise.all(
            [ctx.owner, ctx.renter, ctx.stranger, ctx.admin].map(login),
        );
        ctx.equipmentId = await createEquipment(ctx.owner.id, { dailyRate: 1000, deposit: 0 });
    });

    beforeEach(() => resetRateLimits());

    test('operational endpoints', async () => {
        for (const path of ['/health', '/api/health', '/api/v1/health']) {
            await check(`GET ${path}`, anon().get(path), 200);
        }
        await check('GET /health/full', anon().get('/health/full'), 200);
        await check('GET /metrics', anon().get('/metrics'), 200);
        const stats = await check('GET /api/v1/stats', anon().get('/api/v1/stats'), 200);
        for (const key of ['machines', 'renters', 'bookings', 'states']) expect(Number.isInteger(stats[key])).toBe(true);
        await anon().post('/api/v1/stats').expect(404);
        await check('GET /api/dev/emails', anon().get('/api/dev/emails'), 200);
        await check('DELETE /api/dev/emails', anon().delete('/api/dev/emails'), 200);
        await anon().post('/health').expect(404);
    });

    test('auth: service, availability, login, OTP login, sessions, refresh, logout', async () => {
        await check('GET /api/v1/auth', anon().get('/api/v1/auth'), 200);

        const availability = await check(
            'GET /api/v1/auth/check-availability',
            anon().get(`/api/v1/auth/check-availability?email=${ctx.renter.email}`),
            200,
        );
        expect(availability.emailTaken).toBe(true);
        await check('GET /api/v1/auth/check-availability', anon().get('/api/v1/auth/check-availability'), 400);

        await check(
            'POST /api/v1/auth/login',
            anon().post('/api/v1/auth/login').send({ email: ctx.stranger.email, password: 'Wrong@1234' }),
            401,
            'INVALID_CREDENTIALS',
        );
        await check('POST /api/v1/auth/login', anon().post('/api/v1/auth/login').send({ email: 'x' }), 400, 'VALIDATION_ERROR');

        const sent = await check(
            'POST /api/v1/auth/login-send-otp',
            anon().post('/api/v1/auth/login-send-otp').send({ email: ctx.stranger.email }),
            200,
        );
        await check('POST /api/v1/auth/login-send-otp', anon().post('/api/v1/auth/login-send-otp').send({}), 400);
        await check(
            'POST /api/v1/auth/login-verify-otp',
            anon().post('/api/v1/auth/login-verify-otp').send({ email: ctx.stranger.email, otp: sent.devOtp }),
            200,
        );
        await check(
            'POST /api/v1/auth/login-verify-otp',
            anon().post('/api/v1/auth/login-verify-otp').send({ email: ctx.stranger.email, otp: '12' }),
            400,
            'VALIDATION_ERROR',
        );

        await check('GET /api/v1/auth/me', ctx.renterAgent.get('/api/v1/auth/me'), 200);
        await check('GET /api/v1/auth/me', anon().get('/api/v1/auth/me'), 401);

        const sessions = await check('GET /api/v1/auth/sessions', ctx.renterAgent.get('/api/v1/auth/sessions'), 200);
        expect(sessions.sessions.some((s) => s.current)).toBe(true);
        await check('GET /api/v1/auth/sessions', anon().get('/api/v1/auth/sessions'), 401);

        // A second session for the stranger, then log it out remotely.
        const extra = await login(ctx.stranger);
        const strangerSessions = await check('GET /api/v1/auth/sessions', extra.get('/api/v1/auth/sessions'), 200);
        const other = strangerSessions.sessions.find((s) => !s.current);
        await check('POST /api/v1/auth/sessions/:id/logout', extra.post(`/api/v1/auth/sessions/${other.id}/logout`), 200);
        await check(
            'POST /api/v1/auth/sessions/:id/logout',
            extra.post(`/api/v1/auth/sessions/${NIL_UUID}/logout`),
            404,
            'SESSION_NOT_FOUND',
        );

        const throwaway = await login(await createUser('farmer'));
        await check('POST /api/v1/auth/refresh', throwaway.post('/api/v1/auth/refresh'), 200);
        await check('POST /api/v1/auth/refresh', anon().post('/api/v1/auth/refresh'), 401, 'NO_REFRESH_TOKEN');
        await check('POST /api/v1/auth/logout', throwaway.post('/api/v1/auth/logout'), 200);
        await check('POST /api/v1/auth/logout', anon().post('/api/v1/auth/logout'), 200);
    });

    test('auth: registration OTPs, email verification, password reset, phone OTP, Google', async () => {
        const email = uniqueEmail('contract');
        const phone = randomPhone();
        const emailOtp = await check(
            'POST /api/v1/auth/reg-email-send-otp',
            anon().post('/api/v1/auth/reg-email-send-otp').send({ email }),
            200,
        );
        await check('POST /api/v1/auth/reg-email-send-otp', anon().post('/api/v1/auth/reg-email-send-otp').send({ email: 'nope' }), 400);
        await check(
            'POST /api/v1/auth/reg-email-verify-otp',
            anon().post('/api/v1/auth/reg-email-verify-otp').send({ email, otp: emailOtp.devOtp }),
            200,
        );
        await check(
            'POST /api/v1/auth/reg-email-verify-otp',
            anon().post('/api/v1/auth/reg-email-verify-otp').send({ email, otp: '000000' }),
            400,
            'OTP_NOT_FOUND',
        );

        const phoneOtp = await check('POST /api/v1/auth/reg-send-otp', anon().post('/api/v1/auth/reg-send-otp').send({ phone }), 200);
        await check('POST /api/v1/auth/reg-send-otp', anon().post('/api/v1/auth/reg-send-otp').send({ phone: '123' }), 400);
        await check(
            'POST /api/v1/auth/reg-verify-otp',
            anon().post('/api/v1/auth/reg-verify-otp').send({ phone, otp: phoneOtp.devOtp }),
            200,
        );
        await check('POST /api/v1/auth/reg-verify-otp', anon().post('/api/v1/auth/reg-verify-otp').send({ phone, otp: 'abcdef' }), 400);

        const registered = await check(
            'POST /api/v1/auth/register',
            anon().post('/api/v1/auth/register').send({ email, password: 'Contract@123', name: 'Contract User', phone, role: 'farmer' }),
            201,
        );
        await check(
            'POST /api/v1/auth/register',
            anon()
                .post('/api/v1/auth/register')
                .send({ email: uniqueEmail('x'), password: 'Contract@123', name: 'Unverified User', phone: randomPhone() }),
            400,
            'EMAIL_NOT_VERIFIED',
        );

        await check('POST /api/v1/auth/resend-verification', anon().post('/api/v1/auth/resend-verification').send({ email }), 200);
        await check('POST /api/v1/auth/resend-verification', anon().post('/api/v1/auth/resend-verification').send({}), 400);
        await check(
            'POST /api/v1/auth/verify-email',
            anon().post('/api/v1/auth/verify-email').send({ token: 'not-a-real-token' }),
            400,
            'INVALID_TOKEN',
        );
        await check('POST /api/v1/auth/verify-email', anon().post('/api/v1/auth/verify-email').send({}), 400, 'VALIDATION_ERROR');

        const forgot = await check('POST /api/v1/auth/forgot-password', anon().post('/api/v1/auth/forgot-password').send({ email }), 200);
        await check('POST /api/v1/auth/forgot-password', anon().post('/api/v1/auth/forgot-password').send({}), 400);
        const token = new URL(forgot.devResetLink).searchParams.get('token');
        await check(
            'POST /api/v1/auth/reset-password',
            anon().post('/api/v1/auth/reset-password').send({ token, password: 'Changed@1234' }),
            200,
        );
        await check(
            'POST /api/v1/auth/reset-password',
            anon().post('/api/v1/auth/reset-password').send({ token, password: 'Changed@1234' }),
            400,
            'INVALID_TOKEN',
        );
        await anon().post('/api/v1/auth/login').send({ email, password: 'Changed@1234' }).expect(200);
        expect(registered.user.email).toBe(email);

        const agent = await login(await createUser('farmer'));
        const newPhone = randomPhone();
        const sms = await check('POST /api/v1/auth/send-otp', agent.post('/api/v1/auth/send-otp').send({ phone: newPhone }), 200);
        await check('POST /api/v1/auth/send-otp', agent.post('/api/v1/auth/send-otp').send({ phone: '1' }), 400);
        await check('POST /api/v1/auth/verify-otp', agent.post('/api/v1/auth/verify-otp').send({ otp: sms.devOtp }), 200);
        await check('POST /api/v1/auth/verify-otp', agent.post('/api/v1/auth/verify-otp').send({ otp: '123456' }), 400, 'OTP_NOT_FOUND');

        await check('GET /api/v1/auth/google', anon().get('/api/v1/auth/google'), 503, 'GOOGLE_LOGIN_UNAVAILABLE');
        await check(
            'GET /api/v1/auth/google/callback',
            anon().get('/api/v1/auth/google/callback?code=mock_x&state=y'),
            503,
            'GOOGLE_LOGIN_UNAVAILABLE',
        );
    });

    test('users: profile, password, avatar, wallet, addresses, preferences', async () => {
        const user = await createUser('farmer');
        const agent = await login(user);

        await check('GET /api/v1/users/profile', agent.get('/api/v1/users/profile'), 200);
        await check('GET /api/v1/users/profile', anon().get('/api/v1/users/profile'), 401);
        await check('PATCH /api/v1/users/profile', agent.patch('/api/v1/users/profile').send({ name: 'Renamed Farmer' }), 200);
        await check('PATCH /api/v1/users/profile', agent.patch('/api/v1/users/profile').send({ phone: '12' }), 400);
        // The profile page sends phone: null when the field is emptied.
        const cleared = await check(
            'PATCH /api/v1/users/profile',
            agent.patch('/api/v1/users/profile').send({ name: 'Renamed Farmer', phone: null }),
            200,
        );
        expect(cleared.user.phone).toBeNull();

        await check(
            'POST /api/v1/users/change-password',
            agent.post('/api/v1/users/change-password').send({ currentPassword: 'Wrong@1234', newPassword: 'Newpass@123' }),
            400,
        );
        await check(
            'POST /api/v1/users/change-password',
            agent.post('/api/v1/users/change-password').send({ currentPassword: user.password, newPassword: 'Newpass@123' }),
            200,
        );

        await check(
            'POST /api/v1/users/avatar',
            agent.post('/api/v1/users/avatar').attach('avatar', PNG, { filename: 'a.png', contentType: 'image/png' }),
            200,
        );
        await check(
            'POST /api/v1/users/avatar',
            agent
                .post('/api/v1/users/avatar')
                .attach('avatar', Buffer.from('not an image'), { filename: 'a.png', contentType: 'image/png' }),
            400,
        );

        await check('GET /api/v1/users/wallet', agent.get('/api/v1/users/wallet'), 200);
        await check('GET /api/v1/users/wallet', anon().get('/api/v1/users/wallet'), 401);

        const address = {
            name: 'Home',
            address_line1: '12 Farm Road',
            city: 'Anantapur',
            state: 'Andhra Pradesh',
            pincode: '515001',
            is_default: true,
        };
        const created = await check('POST /api/v1/users/addresses', agent.post('/api/v1/users/addresses').send(address), 201);
        await check('POST /api/v1/users/addresses', agent.post('/api/v1/users/addresses').send({ ...address, pincode: 'x' }), 400);
        await check('GET /api/v1/users/addresses', agent.get('/api/v1/users/addresses'), 200);
        await check('GET /api/v1/users/addresses', anon().get('/api/v1/users/addresses'), 401);
        await check(
            'PUT /api/v1/users/addresses/:id',
            agent.put(`/api/v1/users/addresses/${created.address.id}`).send({ city: 'Guntur' }),
            200,
        );
        await check(
            'PUT /api/v1/users/addresses/:id',
            ctx.strangerAgent.put(`/api/v1/users/addresses/${created.address.id}`).send({ city: 'Guntur' }),
            404,
        );
        await check('DELETE /api/v1/users/addresses/:id', ctx.strangerAgent.delete(`/api/v1/users/addresses/${created.address.id}`), 404);
        await check('DELETE /api/v1/users/addresses/:id', agent.delete(`/api/v1/users/addresses/${created.address.id}`), 200);

        await check('GET /api/v1/users/preferences', agent.get('/api/v1/users/preferences'), 200);
        await check('GET /api/v1/users/preferences', anon().get('/api/v1/users/preferences'), 401);
        await check('PUT /api/v1/users/preferences', agent.put('/api/v1/users/preferences').send({ sms: false }), 200);
        await check('PUT /api/v1/users/preferences', agent.put('/api/v1/users/preferences').send({ sms: 'no' }), 400);
    });

    test('machines, search, reviews, favorites', async () => {
        const listing = {
            name: 'Contract Harvester',
            type: 'combine-harvester',
            pricing: { baseRatePerDay: 2500 },
            location: { district: 'Guntur', state: 'Andhra Pradesh', coordinates: { coordinates: [80.43, 16.3] } },
        };
        const machine = await check('POST /api/v1/machines', ctx.ownerAgent.post('/api/v1/machines').send(listing), 201);
        await check('POST /api/v1/machines', ctx.ownerAgent.post('/api/v1/machines').send({ name: 'x' }), 400);
        await check('GET /api/v1/machines', anon().get('/api/v1/machines?type=combine-harvester'), 200);
        await check('GET /api/v1/machines', anon().get('/api/v1/machines?limit=0'), 400);
        await check('GET /api/v1/machines/:id', anon().get(`/api/v1/machines/${machine.id}`), 200);
        await check('GET /api/v1/machines/:id', anon().get(`/api/v1/machines/${NIL_UUID}`), 404);
        await check('GET /api/v1/machines/nearby', anon().get('/api/v1/machines/nearby?lat=16.3&lng=80.43'), 200);
        await check('GET /api/v1/machines/nearby', anon().get('/api/v1/machines/nearby'), 400);
        await check(
            'PATCH /api/v1/machines/:id',
            ctx.ownerAgent.patch(`/api/v1/machines/${machine.id}`).send({ description: 'Updated' }),
            200,
        );
        await check(
            'PATCH /api/v1/machines/:id',
            ctx.strangerAgent.patch(`/api/v1/machines/${machine.id}`).send({ description: 'x' }),
            403,
        );

        await check('GET /api/v1/search/machines', anon().get('/api/v1/search/machines?q=Harvester'), 200);
        await check('GET /api/v1/search/nearby', anon().get('/api/v1/search/nearby?lat=16.3&lng=80.43'), 200);
        await check('GET /api/v1/search/nearby', anon().get('/api/v1/search/nearby?lat=abc'), 400);
        await check('GET /api/v1/search/autocomplete', anon().get('/api/v1/search/autocomplete?q=har'), 200);
        // Geocoding calls OpenStreetMap; the endpoints validate input and degrade to empty results offline.
        await check('GET /api/v1/search/geocode', anon().get('/api/v1/search/geocode?lat=16.3&lng=80.43'), 200);
        await check('GET /api/v1/search/geocode', anon().get('/api/v1/search/geocode'), 400);
        await check('GET /api/v1/search/places', anon().get('/api/v1/search/places?q=Guntur'), 200);
        await check('GET /api/v1/search/places', anon().get('/api/v1/search/places?q=G'), 400);
        await check('GET /api/v1/search/pincode', anon().get('/api/v1/search/pincode?code=522001'), [200, 404]);
        await check('GET /api/v1/search/pincode', anon().get('/api/v1/search/pincode?code=12'), 400);

        await check('POST /api/v1/favorites/:equipmentId', ctx.renterAgent.post(`/api/v1/favorites/${machine.id}`), 201);
        await check('POST /api/v1/favorites/:equipmentId', ctx.renterAgent.post(`/api/v1/favorites/${NIL_UUID}`), 404);
        const ids = await check('GET /api/v1/favorites/ids', ctx.renterAgent.get('/api/v1/favorites/ids'), 200);
        expect(ids.ids).toContain(machine.id);
        await check('GET /api/v1/favorites/ids', anon().get('/api/v1/favorites/ids'), 401);
        await check('GET /api/v1/favorites', ctx.renterAgent.get('/api/v1/favorites'), 200);
        await check('GET /api/v1/favorites', anon().get('/api/v1/favorites'), 401);
        await check('DELETE /api/v1/favorites/:equipmentId', ctx.renterAgent.delete(`/api/v1/favorites/${machine.id}`), 200);
        await check('DELETE /api/v1/favorites/:equipmentId', ctx.renterAgent.delete('/api/v1/favorites/not-a-uuid'), 404);

        await check('GET /api/v1/reviews/machine/:id', anon().get(`/api/v1/reviews/machine/${machine.id}`), 200);
        await check('GET /api/v1/reviews/machine/:id', anon().get('/api/v1/reviews/machine/not-a-uuid'), 404);
        await check('DELETE /api/v1/machines/:id', ctx.strangerAgent.delete(`/api/v1/machines/${machine.id}`), 403);
        await check('DELETE /api/v1/machines/:id', ctx.ownerAgent.delete(`/api/v1/machines/${machine.id}`), 204);
    });

    test('bookings: lifecycle, pricing, extensions, messages, disputes, reviews, invoices, payments', async () => {
        const { ownerAgent, renterAgent, strangerAgent, adminAgent, equipmentId } = ctx;

        await check('GET /api/v1/bookings/pricing', anon().get('/api/v1/bookings/pricing'), 200);
        await check(
            'GET /api/v1/bookings/quote',
            anon().get(`/api/v1/bookings/quote?equipment_id=${equipmentId}&start_date=${isoDate(10)}&end_date=${isoDate(11)}`),
            200,
        );
        await check(
            'GET /api/v1/bookings/quote',
            anon().get(`/api/v1/bookings/quote?equipment_id=${equipmentId}&start_date=bad&end_date=${isoDate(11)}`),
            400,
        );
        await check(
            'POST /api/v1/bookings/promo/validate',
            renterAgent.post('/api/v1/bookings/promo/validate').send({ code: 'FARM100', amount: 2000 }),
            [200, 404],
        );
        await check('POST /api/v1/bookings/promo/validate', renterAgent.post('/api/v1/bookings/promo/validate').send({ code: '' }), 400);

        const booking = await check(
            'POST /api/v1/bookings',
            renterAgent
                .post('/api/v1/bookings')
                .send({ machineId: equipmentId, startDate: isoDate(10), endDate: isoDate(12), paymentMethod: 'cod' }),
            201,
        );
        await resetRateLimits();
        await check(
            'POST /api/v1/bookings',
            renterAgent.post('/api/v1/bookings').send({ machineId: equipmentId, startDate: isoDate(11), endDate: isoDate(13) }),
            409,
            'BOOKING_CONFLICT',
        );
        const b = `/api/v1/bookings/${booking.id}`;

        await check('GET /api/v1/bookings', renterAgent.get('/api/v1/bookings'), 200);
        await check('GET /api/v1/bookings', anon().get('/api/v1/bookings'), 401);
        await check('GET /api/v1/bookings/my', renterAgent.get('/api/v1/bookings/my?limit=5'), 200);
        await check('GET /api/v1/bookings/my', renterAgent.get('/api/v1/bookings/my?limit=500'), 400);
        await check('GET /api/v1/bookings/incoming', ownerAgent.get('/api/v1/bookings/incoming'), 200);
        await check('GET /api/v1/bookings/incoming', anon().get('/api/v1/bookings/incoming'), 401);
        const noTrips = await check('GET /api/v1/bookings/driver', ownerAgent.get('/api/v1/bookings/driver'), 200);
        expect(noTrips).toMatchObject({ bookings: [], total: 0 });
        await check('GET /api/v1/bookings/driver', anon().get('/api/v1/bookings/driver'), 401);
        await check('GET /api/v1/bookings/availability/:equipmentId', anon().get(`/api/v1/bookings/availability/${equipmentId}`), 200);
        await check('GET /api/v1/bookings/availability/:equipmentId', anon().get('/api/v1/bookings/availability/nope'), 404);
        await check('GET /api/v1/bookings/:id', renterAgent.get(b), 200);
        await check('GET /api/v1/bookings/:id', strangerAgent.get(b), 404);

        await check('POST /api/v1/messages/:bookingId', renterAgent.post(`/api/v1/messages/${booking.id}`).send({ content: 'Hello' }), 201);
        await check('POST /api/v1/messages/:bookingId', renterAgent.post(`/api/v1/messages/${booking.id}`).send({ content: '' }), 400);
        await check('GET /api/v1/messages/:bookingId', ownerAgent.get(`/api/v1/messages/${booking.id}`), 200);
        await check('GET /api/v1/messages/:bookingId', strangerAgent.get(`/api/v1/messages/${booking.id}`), 404);
        await check('PATCH /api/v1/messages/:bookingId/read', ownerAgent.patch(`/api/v1/messages/${booking.id}/read`), 200);
        await check('PATCH /api/v1/messages/:bookingId/read', strangerAgent.patch(`/api/v1/messages/${booking.id}/read`), 404);

        // Payments: the local stack has no Razorpay keys, so gateway operations fail cleanly with 503.
        const idem = () => ({ 'Idempotency-Key': `contract-${Date.now()}-${Math.random().toString(36).slice(2)}` });
        await check(
            'POST /api/payment/create-order',
            renterAgent.post('/api/payment/create-order').set(idem()).send({ bookingId: booking.id }),
            503,
            'PAYMENTS_UNAVAILABLE',
        );
        await check(
            'POST /api/payment/create-order',
            renterAgent.post('/api/payment/create-order').set(idem()).send({ amount: 1 }),
            400,
            'VALIDATION_ERROR',
        );
        await check(
            'POST /api/payment/verify',
            renterAgent
                .post('/api/payment/verify')
                .set(idem())
                .send({ razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's' }),
            503,
        );
        await check('POST /api/payment/verify', renterAgent.post('/api/payment/verify').send({ razorpay_order_id: 'o' }), 400);
        await check(
            'POST /api/payment/refund',
            renterAgent.post('/api/payment/refund').set(idem()).send({ bookingId: booking.id }),
            409,
            'REFUND_NOT_ALLOWED',
        );
        await check('POST /api/payment/refund', renterAgent.post('/api/payment/refund').set(idem()).send({ bookingId: 'x' }), 400);
        await check('GET /api/payment/status', renterAgent.get('/api/payment/status?orderId=order_missing'), 404, 'PAYMENT_NOT_FOUND');
        await check('GET /api/payment/status', renterAgent.get('/api/payment/status'), 400);
        await check('GET /api/payment/refund-status', renterAgent.get(`/api/payment/refund-status?bookingId=${booking.id}`), 200);
        await check('GET /api/payment/refund-status', strangerAgent.get(`/api/payment/refund-status?bookingId=${booking.id}`), 404);
        await check(
            'POST /api/payment/webhook',
            anon().post('/api/payment/webhook').set('Content-Type', 'application/json').send('{}'),
            503,
        );

        await check('PATCH /api/v1/bookings/:id/accept', renterAgent.patch(`${b}/accept`), 403);
        await check('PATCH /api/v1/bookings/:id/accept', ownerAgent.patch(`${b}/accept`), 200);
        await check('POST /api/v1/bookings/:id/extensions', renterAgent.post(`${b}/extensions`).send({ new_end_date: isoDate(14) }), 201);
        await check('POST /api/v1/bookings/:id/extensions', renterAgent.post(`${b}/extensions`).send({ new_end_date: 'soon' }), 400);
        const extensions = await check('GET /api/v1/bookings/:id/extensions', ownerAgent.get(`${b}/extensions`), 200);
        await check('GET /api/v1/bookings/:id/extensions', strangerAgent.get(`${b}/extensions`), 404);
        await check(
            'PATCH /api/v1/bookings/:id/extensions/:extId',
            renterAgent.patch(`${b}/extensions/${extensions[0].id}`).send({ status: 'approved' }),
            403,
        );
        await check(
            'PATCH /api/v1/bookings/:id/extensions/:extId',
            ownerAgent.patch(`${b}/extensions/${extensions[0].id}`).send({ status: 'approved' }),
            200,
        );
        expect((await renterAgent.get(b)).body.data.end_date).toBe(isoDate(14));

        await check('PATCH /api/v1/bookings/:id/start', renterAgent.patch(`${b}/start`), 403);
        await check('PATCH /api/v1/bookings/:id/start', ownerAgent.patch(`${b}/start`), 200);
        const otp = await check('GET /api/v1/bookings/:id/completion-otp', renterAgent.get(`${b}/completion-otp`), 200);
        await check('GET /api/v1/bookings/:id/completion-otp', ownerAgent.get(`${b}/completion-otp`), 403);
        await check('POST /api/v1/bookings/:id/return', ownerAgent.post(`${b}/return`), 403);
        await check('POST /api/v1/bookings/:id/return', renterAgent.post(`${b}/return`), 200);
        await check('POST /api/v1/bookings/:id/complete', ownerAgent.post(`${b}/complete`).send({ otp: '12' }), 400, 'VALIDATION_ERROR');
        await check('POST /api/v1/bookings/:id/complete', ownerAgent.post(`${b}/complete`).send({ otp: otp.otp }), 200);
        await check('PATCH /api/v1/bookings/:id/complete', adminAgent.patch(`${b}/complete`).send({}), 409, 'INVALID_TRANSITION');

        await check('GET /api/v1/invoices/:bookingId', renterAgent.get(`/api/v1/invoices/${booking.id}`), 200);
        await check('GET /api/v1/invoices/:bookingId', strangerAgent.get(`/api/v1/invoices/${booking.id}`), [403, 404]);

        const review = await check(
            'POST /api/v1/reviews',
            renterAgent.post('/api/v1/reviews').send({ bookingId: booking.id, rating: 5 }),
            201,
        );
        await check('POST /api/v1/reviews', renterAgent.post('/api/v1/reviews').send({ bookingId: booking.id, rating: 9 }), 400);
        await check('DELETE /api/v1/reviews/:id', strangerAgent.delete(`/api/v1/reviews/${review.review.id}`), 403);
        await check('DELETE /api/v1/reviews/:id', renterAgent.delete(`/api/v1/reviews/${review.review.id}`), 200);

        const dispute = await check(
            'POST /api/v1/disputes',
            renterAgent
                .post('/api/v1/disputes')
                .send({ bookingId: booking.id, type: 'equipment_damage', description: 'Hydraulic lift stopped working' }),
            201,
        );
        await check(
            'POST /api/v1/disputes',
            renterAgent.post('/api/v1/disputes').send({ bookingId: booking.id, type: 'other', description: 'short' }),
            400,
        );
        await check('GET /api/v1/disputes/my', renterAgent.get('/api/v1/disputes/my'), 200);
        await check('GET /api/v1/disputes/my', anon().get('/api/v1/disputes/my'), 401);
        await check('GET /api/v1/disputes/admin', adminAgent.get('/api/v1/disputes/admin'), 200);
        await check('GET /api/v1/disputes/admin', renterAgent.get('/api/v1/disputes/admin'), 403);
        await check(
            'PATCH /api/v1/disputes/admin/:id',
            adminAgent.patch(`/api/v1/disputes/admin/${dispute.dispute.id}`).send({ status: 'under_review' }),
            200,
        );
        await check(
            'PATCH /api/v1/disputes/admin/:id',
            adminAgent.patch(`/api/v1/disputes/admin/${dispute.dispute.id}`).send({ status: 'lost' }),
            400,
        );

        // Cancel and reject paths on fresh requests.
        await resetRateLimits();
        const toCancel = await check(
            'POST /api/v1/bookings',
            renterAgent.post('/api/v1/bookings').send({ machineId: equipmentId, startDate: isoDate(30), endDate: isoDate(30) }),
            201,
        );
        await check('PATCH /api/v1/bookings/:id/cancel', strangerAgent.patch(`/api/v1/bookings/${toCancel.id}/cancel`), 404);
        await check(
            'PATCH /api/v1/bookings/:id/cancel',
            renterAgent.patch(`/api/v1/bookings/${toCancel.id}/cancel`).send({ reason: 'Weather' }),
            200,
        );
        const toReject = await check(
            'POST /api/v1/bookings',
            renterAgent.post('/api/v1/bookings').send({ machineId: equipmentId, startDate: isoDate(31), endDate: isoDate(31) }),
            201,
        );
        await check('PATCH /api/v1/bookings/:id/reject', renterAgent.patch(`/api/v1/bookings/${toReject.id}/reject`), 403);
        await check('PATCH /api/v1/bookings/:id/reject', ownerAgent.patch(`/api/v1/bookings/${toReject.id}/reject`), 200);
    });

    test('offers and equipment chats', async () => {
        const offer = await check(
            'POST /api/v1/offers',
            ctx.renterAgent
                .post('/api/v1/offers')
                .send({ equipment_id: ctx.equipmentId, offered_price_per_day: 800, start_date: isoDate(40), end_date: isoDate(42) }),
            201,
        );
        await check(
            'POST /api/v1/offers',
            ctx.renterAgent.post('/api/v1/offers').send({ equipment_id: ctx.equipmentId, offered_price_per_day: -1 }),
            400,
        );
        await check('GET /api/v1/offers/my', ctx.renterAgent.get('/api/v1/offers/my'), 200);
        await check('GET /api/v1/offers/my', anon().get('/api/v1/offers/my'), 401);
        await check('GET /api/v1/offers/received', ctx.ownerAgent.get('/api/v1/offers/received'), 200);
        await check('GET /api/v1/offers/received', anon().get('/api/v1/offers/received'), 401);
        await check(
            'PATCH /api/v1/offers/:id/respond',
            ctx.ownerAgent.patch(`/api/v1/offers/${offer.offer.id}/respond`).send({ action: 'counter', counter_price: 900 }),
            200,
        );
        await check(
            'PATCH /api/v1/offers/:id/respond',
            ctx.ownerAgent.patch(`/api/v1/offers/${offer.offer.id}/respond`).send({ action: 'accept' }),
            409,
            'OFFER_ALREADY_ANSWERED',
        );

        const chat = await check(
            'POST /api/v1/messages/chat/init',
            ctx.renterAgent.post('/api/v1/messages/chat/init').send({ equipment_id: ctx.equipmentId }),
            201,
        );
        await check(
            'POST /api/v1/messages/chat/init',
            ctx.ownerAgent.post('/api/v1/messages/chat/init').send({ equipment_id: ctx.equipmentId }),
            400,
            'OWN_EQUIPMENT',
        );
        const c = `/api/v1/messages/chat/${chat.chat_id}`;
        await check('POST /api/v1/messages/chat/:chatId', ctx.renterAgent.post(c).send({ content: 'Is it available next week?' }), 201);
        await check('POST /api/v1/messages/chat/:chatId', ctx.strangerAgent.post(c).send({ content: 'hi' }), 404);
        await check('GET /api/v1/messages/chat/:chatId', ctx.ownerAgent.get(c), 200);
        await check('GET /api/v1/messages/chat/:chatId', ctx.strangerAgent.get(c), 404);
        await check('PATCH /api/v1/messages/chat/:chatId/read', ctx.ownerAgent.patch(`${c}/read`), 200);
        await check('PATCH /api/v1/messages/chat/:chatId/read', ctx.strangerAgent.patch(`${c}/read`), 404);
        const inbox = await check('GET /api/v1/messages/chats', ctx.ownerAgent.get('/api/v1/messages/chats'), 200);
        expect(inbox.chats.find((x) => x.id === chat.chat_id).unread_count).toBe(0);
        await check('GET /api/v1/messages/chats', anon().get('/api/v1/messages/chats'), 401);
    });

    test('notifications, saved searches, KYC, uploads', async () => {
        const agent = await login(await createUser('farmer'));
        const me = (await agent.get('/api/v1/auth/me')).body.data.user;
        const { rows } = await withDb((db) =>
            db.query(
                `INSERT INTO notifications (user_id, title, message) VALUES ($1, 'Test', 'Hello'), ($1, 'Test 2', 'Hi') RETURNING id`,
                [me.id],
            ),
        );
        await check('GET /api/v1/notifications', agent.get('/api/v1/notifications'), 200);
        await check('GET /api/v1/notifications', anon().get('/api/v1/notifications'), 401);
        await check('PATCH /api/v1/notifications/:id/read', agent.patch(`/api/v1/notifications/${rows[0].id}/read`), 200);
        await check('PATCH /api/v1/notifications/:id/read', ctx.strangerAgent.patch(`/api/v1/notifications/${rows[0].id}/read`), 404);
        await check('PATCH /api/v1/notifications/read-all', agent.patch('/api/v1/notifications/read-all'), 200);
        await check('PATCH /api/v1/notifications/read-all', anon().patch('/api/v1/notifications/read-all'), 401);
        await check('DELETE /api/v1/notifications/:id', agent.delete(`/api/v1/notifications/${rows[1].id}`), 200);
        await check('DELETE /api/v1/notifications/:id', agent.delete('/api/v1/notifications/not-a-uuid'), 404);

        const saved = await check(
            'POST /api/v1/saved-searches',
            agent.post('/api/v1/saved-searches').send({ name: 'Tractors near me', filters: { type: 'tractor' } }),
            201,
        );
        await check('POST /api/v1/saved-searches', agent.post('/api/v1/saved-searches').send({ name: '' }), 400);
        await check('GET /api/v1/saved-searches', agent.get('/api/v1/saved-searches'), 200);
        await check('GET /api/v1/saved-searches', anon().get('/api/v1/saved-searches'), 401);
        await check('PATCH /api/v1/saved-searches/:id', agent.patch(`/api/v1/saved-searches/${saved.id}`).send({ alert_on: true }), 200);
        await check(
            'PATCH /api/v1/saved-searches/:id',
            ctx.strangerAgent.patch(`/api/v1/saved-searches/${saved.id}`).send({ alert_on: true }),
            404,
        );
        await check('DELETE /api/v1/saved-searches/:id', ctx.strangerAgent.delete(`/api/v1/saved-searches/${saved.id}`), 404);
        await check('DELETE /api/v1/saved-searches/:id', agent.delete(`/api/v1/saved-searches/${saved.id}`), 204);

        const doc = await check(
            'POST /api/v1/kyc/upload',
            agent
                .post('/api/v1/kyc/upload')
                .field('doc_type', 'aadhar')
                .attach('document', PNG, { filename: 'id.png', contentType: 'image/png' }),
            201,
        );
        await check(
            'POST /api/v1/kyc/upload',
            agent
                .post('/api/v1/kyc/upload')
                .field('doc_type', 'passport')
                .attach('document', PNG, { filename: 'id.png', contentType: 'image/png' }),
            400,
        );
        await check('GET /api/v1/kyc/status', agent.get('/api/v1/kyc/status'), 200);
        await check('GET /api/v1/kyc/status', anon().get('/api/v1/kyc/status'), 401);
        await check('GET /api/v1/kyc/documents/:id/file', agent.get(`/api/v1/kyc/documents/${doc.document.id}/file`), 200);
        await check('GET /api/v1/kyc/documents/:id/file', ctx.strangerAgent.get(`/api/v1/kyc/documents/${doc.document.id}/file`), 404);
        await check('GET /api/v1/kyc/admin', ctx.adminAgent.get('/api/v1/kyc/admin'), 200);
        await check('GET /api/v1/kyc/admin', agent.get('/api/v1/kyc/admin'), 403);
        await check(
            'PATCH /api/v1/kyc/admin/:id/reject',
            ctx.adminAgent.patch(`/api/v1/kyc/admin/${doc.document.id}/reject`).send({}),
            400,
        );
        await check(
            'PATCH /api/v1/kyc/admin/:id/reject',
            ctx.adminAgent.patch(`/api/v1/kyc/admin/${doc.document.id}/reject`).send({ reason: 'Blurry' }),
            200,
        );
        await check('PATCH /api/v1/kyc/admin/:id/approve', ctx.adminAgent.patch(`/api/v1/kyc/admin/${NIL_UUID}/approve`), 404);
        await check('PATCH /api/v1/kyc/admin/:id/approve', ctx.adminAgent.patch(`/api/v1/kyc/admin/${doc.document.id}/approve`), 200);

        await check(
            'POST /api/v1/upload/images',
            agent.post('/api/v1/upload/images').attach('images', PNG, { filename: 'm.png', contentType: 'image/png' }),
            201,
        );
        await check(
            'POST /api/v1/upload/images',
            agent.post('/api/v1/upload/images').attach('images', PNG, { filename: 'm.exe', contentType: 'image/png' }),
            400,
        );
        await check(
            'POST /api/v1/upload/kyc',
            agent.post('/api/v1/upload/kyc').attach('document', PNG, { filename: 'k.png', contentType: 'image/png' }),
            201,
        );
        await check('POST /api/v1/upload/kyc', agent.post('/api/v1/upload/kyc'), 400);
        await check(
            'POST /api/v1/upload/presign',
            agent.post('/api/v1/upload/presign').send({ filename: 'a.png', contentType: 'image/png' }),
            200,
        );
        await check('POST /api/v1/upload/presign', agent.post('/api/v1/upload/presign').send({}), 400);
    });

    test('drivers and tracking', async () => {
        const driverUser = await createUser('owner', 'Contract Driver');
        const driver = await login(driverUser);
        const profile = await check(
            'POST /api/v1/drivers/register',
            driver
                .post('/api/v1/drivers/register')
                .send({ vehicle_name: 'Tata Ace', vehicle_type: 'pickup', vehicle_number: 'AP01AB1234' }),
            201,
        );
        await check(
            'POST /api/v1/drivers/register',
            ctx.renterAgent.post('/api/v1/drivers/register').send({ vehicle_name: 'x', vehicle_type: 'x', vehicle_number: 'x' }),
            403,
        );
        await check('GET /api/v1/drivers/me', driver.get('/api/v1/drivers/me'), 200);
        const noProfile = await ctx.renterAgent.get('/api/v1/drivers/me').expect(200);
        expect(noProfile.body.data).toBeNull();
        await check('GET /api/v1/drivers/me', anon().get('/api/v1/drivers/me'), 401);
        await check(
            'PATCH /api/v1/drivers/location',
            driver.patch('/api/v1/drivers/location').send({ latitude: 16.3, longitude: 80.43, speed: 10, accuracy: 10 }),
            200,
        );
        await check('PATCH /api/v1/drivers/location', driver.patch('/api/v1/drivers/location').send({ latitude: 'x' }), 400);
        await check('PATCH /api/v1/drivers/availability', driver.patch('/api/v1/drivers/availability').send({ is_available: true }), 200);
        await check('PATCH /api/v1/drivers/availability', driver.patch('/api/v1/drivers/availability').send({ is_available: 'yes' }), 400);
        await check('PATCH /api/v1/drivers/share-location', driver.patch('/api/v1/drivers/share-location').send({ sharing: true }), 200);
        await check('PATCH /api/v1/drivers/share-location', driver.patch('/api/v1/drivers/share-location').send({}), 400);
        await check('GET /api/v1/drivers/nearby', ctx.renterAgent.get('/api/v1/drivers/nearby?lat=16.3&lng=80.43'), 200);
        await check('GET /api/v1/drivers/nearby', anon().get('/api/v1/drivers/nearby?lat=16.3&lng=80.43'), 401);
        await check('GET /api/v1/drivers', ctx.adminAgent.get('/api/v1/drivers'), 200);
        await check('GET /api/v1/drivers', ctx.ownerAgent.get('/api/v1/drivers'), 403);
        await check('GET /api/v1/drivers/:id', ctx.renterAgent.get(`/api/v1/drivers/${profile.id}`), 200);
        await check('GET /api/v1/drivers/:id', ctx.renterAgent.get('/api/v1/drivers/nope'), 404);
        await check('POST /api/v1/drivers/trip/start', driver.post('/api/v1/drivers/trip/start').send({ booking_id: NIL_UUID }), 404);
        await check('POST /api/v1/drivers/trip/start', driver.post('/api/v1/drivers/trip/start').send({}), 400);
        await check(
            'POST /api/v1/drivers/trip/end',
            driver.post('/api/v1/drivers/trip/end').send({ booking_id: NIL_UUID, otp: '123456' }),
            404,
        );
        await check('POST /api/v1/drivers/trip/end', driver.post('/api/v1/drivers/trip/end').send({ otp: 'x' }), 400);

        // A confirmed booking the renter can track.
        await resetRateLimits();
        const booking = await check(
            'POST /api/v1/bookings',
            ctx.renterAgent.post('/api/v1/bookings').send({ machineId: ctx.equipmentId, startDate: isoDate(50), endDate: isoDate(51) }),
            201,
        );
        await ctx.ownerAgent.patch(`/api/v1/bookings/${booking.id}/accept`).expect(200);
        const t = `/api/v1/tracking/booking/${booking.id}`;
        await check('GET /api/v1/tracking/booking/:bookingId/location', ctx.renterAgent.get(`${t}/location`), 200);
        await check('GET /api/v1/tracking/booking/:bookingId/location', ctx.strangerAgent.get(`${t}/location`), 404);
        await check('GET /api/v1/tracking/booking/:bookingId/route', ctx.ownerAgent.get(`${t}/route`), 200);
        await check('GET /api/v1/tracking/booking/:bookingId/route', anon().get(`${t}/route`), 401);
        await check('GET /api/v1/tracking/booking/:bookingId/history', ctx.renterAgent.get(`${t}/history`), 200);
        await check('GET /api/v1/tracking/booking/:bookingId/history', ctx.strangerAgent.get(`${t}/history`), 404);
        await check(
            'POST /api/v1/tracking/driver-location',
            driver.post('/api/v1/tracking/driver-location').send({ latitude: 16.31, longitude: 80.44 }),
            200,
        );
        await check(
            'POST /api/v1/tracking/driver-location',
            driver.post('/api/v1/tracking/driver-location').send({ latitude: 16.31, longitude: 80.44, bookingId: booking.id }),
            403,
        );
        await check('GET /api/v1/tracking/driver/:driverId/status', driver.get(`/api/v1/tracking/driver/${profile.id}/status`), 200);
        await check(
            'GET /api/v1/tracking/driver/:driverId/status',
            ctx.strangerAgent.get(`/api/v1/tracking/driver/${profile.id}/status`),
            404,
        );
        await check(
            'POST /api/v1/tracking/update',
            driver.post('/api/v1/tracking/update').send({ latitude: 16.31, longitude: 80.44 }),
            200,
        );
        await check(
            'POST /api/v1/tracking/update',
            ctx.renterAgent.post('/api/v1/tracking/update').send({ latitude: 16.31, longitude: 80.44 }),
            404,
        );
        await check(
            'POST /api/v1/tracking/equipment-update',
            ctx.ownerAgent.post('/api/v1/tracking/equipment-update').send({ equipment_id: ctx.equipmentId, lat: 14.7, lng: 77.6 }),
            200,
        );
        await check(
            'POST /api/v1/tracking/equipment-update',
            ctx.strangerAgent.post('/api/v1/tracking/equipment-update').send({ equipment_id: ctx.equipmentId, lat: 14.7, lng: 77.6 }),
            403,
        );
    });

    test('admin, analytics, market insights, weather', async () => {
        const dashboard = await check('GET /api/v1/admin/dashboard', ctx.adminAgent.get('/api/v1/admin/dashboard'), 200);
        expect(dashboard.overview.totalMachines).toBeGreaterThan(0);
        expect(typeof dashboard.revenue.last30Days).toBe('number');
        expect(typeof dashboard.revenue.platformFee).toBe('number');
        await check('GET /api/v1/admin/dashboard', ctx.ownerAgent.get('/api/v1/admin/dashboard'), 403);
        await check('GET /api/v1/admin/users', ctx.adminAgent.get('/api/v1/admin/users'), 200);
        await check('GET /api/v1/admin/users', anon().get('/api/v1/admin/users'), 401);
        await check('GET /api/v1/admin/machines', ctx.adminAgent.get('/api/v1/admin/machines'), 200);
        await check('GET /api/v1/admin/machines', ctx.renterAgent.get('/api/v1/admin/machines'), 403);
        await check('GET /api/v1/admin/bookings', ctx.adminAgent.get('/api/v1/admin/bookings'), 200);
        await check('GET /api/v1/admin/bookings', ctx.ownerAgent.get('/api/v1/admin/bookings'), 403);
        await check(
            'PATCH /api/v1/admin/machines/:id/approve',
            ctx.adminAgent.patch(`/api/v1/admin/machines/${ctx.equipmentId}/approve`),
            200,
        );
        await check('PATCH /api/v1/admin/machines/:id/approve', ctx.adminAgent.patch('/api/v1/admin/machines/not-a-uuid/approve'), 404);
        const flagged = await createEquipment(ctx.owner.id, { dailyRate: 500, deposit: 0 });
        const rejected = await check(
            'PATCH /api/v1/admin/machines/:id/reject',
            ctx.adminAgent.patch(`/api/v1/admin/machines/${flagged}/reject`),
            200,
        );
        expect(rejected).toMatchObject({ status: 'inactive', isApproved: false });
        await check('PATCH /api/v1/admin/machines/:id/reject', ctx.ownerAgent.patch(`/api/v1/admin/machines/${flagged}/reject`), 403);
        const pendingList = await ctx.adminAgent.get('/api/v1/admin/machines?approved=false').expect(200);
        expect(pendingList.body.data.some((m) => m._id === flagged)).toBe(false);

        await check('GET /api/v1/analytics/owner', ctx.ownerAgent.get('/api/v1/analytics/owner'), 200);
        await check('GET /api/v1/analytics/owner', anon().get('/api/v1/analytics/owner'), 401);

        const demand = await check('GET /api/v1/ml/demand-prediction', anon().get('/api/v1/ml/demand-prediction?type=tractor'), 200);
        expect(demand.demand).toHaveLength(12);
        await check('GET /api/v1/ml/recommendations', anon().get('/api/v1/ml/recommendations'), 200);
        const pricing = await check(
            'POST /api/v1/ml/optimal-pricing',
            anon().post('/api/v1/ml/optimal-pricing').send({ type: 'tractor', days: 3 }),
            200,
        );
        expect(pricing.comparables).toBeGreaterThan(0);
        await check('POST /api/v1/ml/optimal-pricing', anon().post('/api/v1/ml/optimal-pricing').send({ days: 0 }), 400);
        await check('GET /api/v1/ml/churn-risk', ctx.adminAgent.get('/api/v1/ml/churn-risk'), 200);
        await check('GET /api/v1/ml/churn-risk', ctx.ownerAgent.get('/api/v1/ml/churn-risk'), 403);

        // Open-Meteo is an external API: 200 online, 502 (never invented data) when unreachable.
        await check('GET /api/v1/weather', anon().get('/api/v1/weather?lat=16.3&lng=80.43'), [200, 502]);
        await check('GET /api/v1/weather', anon().get('/api/v1/weather?lat=100&lng=80'), 400);
    });

    test('every mounted route has a contract check', () => {
        const missing = [...mountedRoutes()].filter((route) => !covered.has(route));
        expect(missing).toEqual([]);
    });
});
