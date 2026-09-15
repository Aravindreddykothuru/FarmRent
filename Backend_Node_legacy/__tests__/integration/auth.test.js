const request = require('supertest');
const { getApp, withDb, resetRateLimits, uniqueEmail, randomPhone, createUser, login, PASSWORD } = require('./helpers');

const cookieValue = (res, name) => {
    const header = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`));
    return header ? header.split(';')[0].slice(name.length + 1) : null;
};

describe('authentication', () => {
    beforeEach(() => resetRateLimits());

    test('register with email OTP → session cookies → /me; password is stored hashed', async () => {
        const agent = request.agent(getApp());
        const email = uniqueEmail('Register').replace('register', 'Register');
        const phone = randomPhone();

        const availability = await agent.get(`/api/v1/auth/check-availability?email=${encodeURIComponent(email)}`).expect(200);
        expect(availability.body.data.emailTaken).toBe(false);

        const sent = await agent.post('/api/v1/auth/reg-email-send-otp').send({ email }).expect(200);
        expect(sent.body.data.devOtp).toMatch(/^\d{6}$/);

        await agent
            .post('/api/v1/auth/reg-email-verify-otp')
            .send({ email, otp: '000000' === sent.body.data.devOtp ? '111111' : '000000' })
            .expect(400);
        await agent.post('/api/v1/auth/reg-email-verify-otp').send({ email, otp: sent.body.data.devOtp }).expect(200);

        const registered = await agent
            .post('/api/v1/auth/register')
            .send({ email, password: PASSWORD, name: 'Ravi Owner', phone, role: 'owner' })
            .expect(201);
        expect(registered.body.data.user).toMatchObject({ email: email.toLowerCase(), role: 'owner', name: 'Ravi Owner' });
        expect(registered.body.data.user).not.toHaveProperty('password_hash');
        const tokenCookie = (registered.headers['set-cookie'] || []).find((c) => c.startsWith('token='));
        expect(tokenCookie).toMatch(/HttpOnly/i);

        const me = await agent.get('/api/v1/auth/me').expect(200);
        expect(me.body.data.user.roles).toEqual(['owner']);

        const stored = await withDb((db) => db.query('SELECT password_hash FROM users WHERE email = $1', [email.toLowerCase()]));
        expect(stored.rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
        expect(stored.rows[0].password_hash).not.toContain(PASSWORD);

        // Email is now taken, so registration cannot be started again for it (case-insensitively).
        const again = await request(getApp()).post('/api/v1/auth/reg-email-send-otp').send({ email: email.toUpperCase() }).expect(409);
        expect(again.body.error.code).toBe('EMAIL_TAKEN');
    });

    test('registration without a verified email, or as admin, is refused', async () => {
        const email = uniqueEmail('unverified');
        const unverified = await request(getApp())
            .post('/api/v1/auth/register')
            .send({ email, password: PASSWORD, name: 'No Otp', phone: randomPhone(), role: 'farmer' })
            .expect(400);
        expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');

        const admin = await request(getApp())
            .post('/api/v1/auth/register')
            .send({ email, password: PASSWORD, name: 'Sneaky', phone: randomPhone(), role: 'admin' })
            .expect(400);
        expect(admin.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('login accepts the right password only and does not reveal whether the email exists', async () => {
        const user = await createUser('farmer');
        const wrong = await request(getApp()).post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong@12345' }).expect(401);
        const unknown = await request(getApp())
            .post('/api/v1/auth/login')
            .send({ email: uniqueEmail('ghost'), password: 'Wrong@12345' })
            .expect(401);
        expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
        expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');

        const ok = await request(getApp())
            .post('/api/v1/auth/login')
            .send({ email: user.email.toUpperCase(), password: PASSWORD })
            .expect(200);
        expect(ok.body.data.user).toMatchObject({ id: user.id, role: 'farmer' });
    });

    test('refresh rotates the refresh token, and replaying the old one revokes every session', async () => {
        const user = await createUser('farmer');
        const loginRes = await request(getApp()).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
        const firstRefresh = cookieValue(loginRes, 'rfsh');
        expect(firstRefresh).toBeTruthy();

        const rotated = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', `rfsh=${firstRefresh}`).expect(200);
        const newAccess = cookieValue(rotated, 'token');
        expect(cookieValue(rotated, 'rfsh')).not.toBe(firstRefresh);
        await request(getApp()).get('/api/v1/auth/me').set('Authorization', `Bearer ${newAccess}`).expect(200);

        const replay = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', `rfsh=${firstRefresh}`).expect(401);
        expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

        const afterBreach = await request(getApp()).get('/api/v1/auth/me').set('Authorization', `Bearer ${newAccess}`).expect(401);
        expect(afterBreach.body.error.code).toBe('SESSION_REVOKED');
    });

    test('logout clears the session: the cookie jar and the old access token both stop working', async () => {
        const user = await createUser('owner');
        const agent = request.agent(getApp());
        const loginRes = await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
        const accessToken = cookieValue(loginRes, 'token');

        await agent.get('/api/v1/bookings/incoming').expect(200);
        await agent.post('/api/v1/auth/logout').expect(200);

        await agent.get('/api/v1/bookings/incoming').expect(401);
        await request(getApp()).get('/api/v1/bookings/incoming').set('Authorization', `Bearer ${accessToken}`).expect(401);
    });

    test('logout after the access token has expired still ends the session and revokes the refresh token', async () => {
        // An idle user's 15-minute access token has usually expired by the time they click Sign Out.
        const jwt = require('jsonwebtoken');
        const { getJwtSecret } = require('../../lib/jwtSecret');
        const user = await createUser('farmer');
        const loginRes = await request(getApp()).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
        const refresh = cookieValue(loginRes, 'rfsh');
        const { iat: _iat, exp: _exp, ...claims } = jwt.decode(cookieValue(loginRes, 'token'));
        const expired = jwt.sign({ ...claims, iat: Math.floor(Date.now() / 1000) - 3600 }, getJwtSecret(), { expiresIn: -60 });

        const out = await request(getApp()).post('/api/v1/auth/logout').set('Cookie', `token=${expired}; rfsh=${refresh}`);
        expect(out.status).toBe(200);
        const cleared = (out.headers['set-cookie'] || []).map((c) => c.split('=')[0]);
        expect(cleared).toEqual(expect.arrayContaining(['token', 'rfsh', 'authRole']));

        // The refresh token must not be able to resurrect the session.
        await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', `rfsh=${refresh}`).expect(401);
    });

    test('switching between farmer and owner mode re-issues the token and never touches the roles table', async () => {
        const user = await createUser('farmer');
        const agent = await login(user);

        await agent
            .post('/api/v1/machines')
            .send({ name: 'Blocked listing', type: 'tractor', pricing: { baseRatePerDay: 900 } })
            .expect(201);
        await agent.get('/api/v1/bookings/incoming').expect(200);

        const switched = await agent.patch('/api/v1/users/profile').send({ role: 'owner' }).expect(200);
        expect(switched.body.data.user.roles).toEqual(['owner']);
        expect((switched.headers['set-cookie'] || []).some((c) => c.startsWith('token='))).toBe(true);

        // The new token carries the owner role: owners cannot place bookings.
        const booking = await agent
            .post('/api/v1/bookings')
            .send({ equipment_id: '5b6d8c1e-0001-4a3b-9c2d-000000000001', start_date: '2031-01-01', end_date: '2031-01-02' });
        expect(booking.status).toBe(403);

        await agent.patch('/api/v1/users/profile').send({ role: 'admin' }).expect(400);

        const roles = await withDb((db) => db.query('SELECT id, name FROM roles ORDER BY id'));
        expect(roles.rows).toEqual([
            { id: 1, name: 'farmer' },
            { id: 2, name: 'buyer' },
            { id: 3, name: 'owner' },
            { id: 4, name: 'admin' },
            { id: 5, name: 'driver' },
        ]);
    });

    test('page-load session calls are not throttled like credential endpoints', async () => {
        const agent = await login(await createUser('farmer'));
        // Every full page load calls /auth/me; 25 in a row is ordinary browsing, not abuse.
        for (let i = 0; i < 25; i += 1) await agent.get('/api/v1/auth/me').expect(200);

        const statuses = [];
        for (let i = 0; i < 21; i += 1) {
            statuses.push((await request(getApp()).get(`/api/v1/auth/check-availability?email=${uniqueEmail('probe')}`)).status);
        }
        expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
        expect(statuses[20]).toBe(429);
    });

    test('each rate limiter counts a sign-in once, so ordinary repeated sign-ins are not throttled', async () => {
        // /login sits behind two limiters (auth router + login route). Sharing one counter made every attempt
        // count twice, so the 11th sign-in from an IP was refused even though no limit had been reached.
        const user = await createUser('farmer');
        const statuses = [];
        for (let i = 0; i < 15; i += 1) {
            statuses.push((await request(getApp()).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD })).status);
        }
        expect(statuses).toEqual(Array(15).fill(200));
    });

    test('non-admins cannot reach admin endpoints', async () => {
        const agent = await login(await createUser('owner'));
        const res = await agent.get('/api/v1/admin/users').expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });
});
