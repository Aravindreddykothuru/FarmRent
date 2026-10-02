/**
 * Signing in and signing up with a mobile number.
 *
 * These run without a TWOFACTOR_API_KEY, so the endpoints take their fallback path: the code is generated
 * here and handed back as `devOtp` instead of being sent by 2Factor. That is deliberate. It exercises the
 * parts worth testing — the limits, the attempt counter, the account lookup, the signup token — against
 * the real Express app, Redis and Postgres, with no paid account and no mocking of our own code. The
 * 2Factor client itself is covered separately in unit tests with the network mocked.
 *
 * Every case uses a fresh random number, because the per-number limits are deliberately sticky.
 */
const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createClient } = require('redis');
const { getApp, withDb, resetRateLimits, uniqueEmail, PASSWORD } = require('./helpers');
const { ROLE_IDS } = require('../../lib/roles');

const anon = () => request(getApp());

/** A number that has not been used by another case in this run. */
const freshPhone = () => `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;

/** An account with a known number, so the login path has something to find. */
async function createUserWithPhone(phone, role = 'farmer') {
    const email = uniqueEmail('phone');
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    return withDb(async (db) => {
        const { rows } = await db.query(
            `INSERT INTO users (email, full_name, phone, password_hash, email_verified, phone_verified)
             VALUES ($1, $2, $3, $4, TRUE, TRUE) RETURNING id`,
            [email, 'Phone User', phone, passwordHash],
        );
        await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [rows[0].id, ROLE_IDS[role]]);
        return { id: rows[0].id, email, phone };
    });
}

/** Drops a Redis key, used to age something out without waiting for its TTL. */
async function dropKey(key) {
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    try {
        await client.del(key);
    } finally {
        await client.quit();
    }
}

/** Clears the 60-second resend hold so a case can ask for a second code immediately. */
const clearResendHold = (phone) => dropKey(`potp-wait:${phone}`);

async function sendOtp(phone, purpose = 'login') {
    return anon().post('/api/v1/auth/phone/send-otp').send({ phone, purpose });
}

async function sendAndRead(phone, purpose = 'login') {
    const res = await sendOtp(phone, purpose);
    expect(res.status).toBe(200);
    expect(res.body.data.devOtp).toMatch(/^\d{6}$/);
    return res.body.data.devOtp;
}

const verify = (phone, otp, purpose = 'login') => anon().post('/api/v1/auth/phone/verify-otp').send({ phone, otp, purpose });

beforeEach(async () => {
    await resetRateLimits();
});

describe('sending a code', () => {
    test('a valid number gets a code and is told when it may ask again', async () => {
        const res = await sendOtp(freshPhone());

        expect(res.status).toBe(200);
        expect(res.body.data.ok).toBe(true);
        expect(res.body.data.resendAfter).toBe(60);
    });

    test('the response never carries the code in production shape, and never the whole number', async () => {
        const phone = freshPhone();
        const res = await sendOtp(phone);

        // devOtp exists only because NODE_ENV is not production; the message itself stays masked either way.
        expect(res.body.data.message).not.toContain(phone);
        expect(res.body.data.message).toContain(`${phone.slice(0, 2)}XXXXXX${phone.slice(-2)}`);
    });

    test('a number that is not an Indian mobile is refused before anything is sent', async () => {
        for (const bad of ['12345', '1234567890', '98765432101', 'abcdefghij']) {
            const res = await anon().post('/api/v1/auth/phone/send-otp').send({ phone: bad, purpose: 'login' });
            expect(res.status).toBe(400);
        }
    });

    test('a second request inside a minute is refused and told how long to wait', async () => {
        const phone = freshPhone();
        await sendOtp(phone);

        const again = await sendOtp(phone);

        expect(again.status).toBe(429);
        expect(again.body.error.code).toBe('OTP_RESEND_TOO_SOON');
        expect(again.body.error.details.resendAfter).toBeGreaterThan(0);
        expect(again.body.error.details.resendAfter).toBeLessThanOrEqual(60);
        expect(again.body.error.message).toMatch(/wait \d+ seconds? to resend/i);
    });

    test('a number is capped at five codes an hour, even once the minute hold is cleared', async () => {
        const phone = freshPhone();

        for (let i = 0; i < 5; i++) {
            const res = await sendOtp(phone);
            expect(res.status).toBe(200);
            await clearResendHold(phone);
        }

        const sixth = await sendOtp(phone);
        expect(sixth.status).toBe(429);
        expect(sixth.body.error.code).toBe('OTP_LIMIT_NUMBER');
    });

    test('signing up with a number that already has an account is refused without sending', async () => {
        const phone = freshPhone();
        await createUserWithPhone(phone);

        const res = await sendOtp(phone, 'signup');

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('PHONE_TAKEN');
    });

    test('each send is recorded for audit, without the code', async () => {
        const phone = freshPhone();
        await sendOtp(phone, 'login');

        const rows = await withDb((db) => db.query('SELECT purpose, status, attempts FROM otp_requests WHERE phone = $1', [phone]));

        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]).toMatchObject({ purpose: 'login', status: 'sent', attempts: 0 });
        // The table has no column that could hold one.
        expect(Object.keys(rows.rows[0])).not.toContain('otp');
    });
});

describe('verifying a code', () => {
    test('the right code signs an existing account in and sets a session cookie', async () => {
        const phone = freshPhone();
        const user = await createUserWithPhone(phone);
        const otp = await sendAndRead(phone);

        const res = await verify(phone, otp);

        expect(res.status).toBe(200);
        expect(res.body.data.user.id).toBe(user.id);
        expect(res.body.data.user.password_hash).toBeUndefined();
        expect(String(res.headers['set-cookie'])).toContain('token=');
    });

    test('a wrong code counts down the tries that are left', async () => {
        const phone = freshPhone();
        await createUserWithPhone(phone);
        await sendAndRead(phone);

        const first = await verify(phone, '000000');
        expect(first.status).toBe(400);
        expect(first.body.error.details.attemptsLeft).toBe(2);
        expect(first.body.error.message).toBe('Wrong OTP, 2 tries left');

        const second = await verify(phone, '000001');
        expect(second.body.error.details.attemptsLeft).toBe(1);
        expect(second.body.error.message).toBe('Wrong OTP, 1 try left');
    });

    test('a fourth attempt is refused and the correct code no longer works', async () => {
        const phone = freshPhone();
        await createUserWithPhone(phone);
        const otp = await sendAndRead(phone);

        await verify(phone, '000000');
        await verify(phone, '000001');
        await verify(phone, '000002');

        const fourth = await verify(phone, '000003');
        expect(fourth.status).toBe(429);
        expect(fourth.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');

        // The point of the lockout: the real code is dead too, so guessing cannot be resumed.
        const withRealCode = await verify(phone, otp);
        expect(withRealCode.status).toBe(400);
        expect(withRealCode.body.error.code).toBe('OTP_NOT_FOUND');
    });

    test('an expired code is refused and says so', async () => {
        const phone = freshPhone();
        await createUserWithPhone(phone);
        const otp = await sendAndRead(phone);

        // Expiry is a Redis TTL; dropping the key is what the clock would do ten minutes later.
        await dropKey(`potp:login:${phone}`);

        const res = await verify(phone, otp);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OTP_NOT_FOUND');
    });

    test('a number with no account is told to create one, and gets no session', async () => {
        const phone = freshPhone();
        const otp = await sendAndRead(phone);

        const res = await verify(phone, otp);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
        expect(res.body.error.message).toBe('Account not found, please create account');
        expect(res.headers['set-cookie']).toBeUndefined();
    });

    test('a verified signup returns a signup token rather than a session', async () => {
        const phone = freshPhone();
        const otp = await sendAndRead(phone, 'signup');

        const res = await verify(phone, otp, 'signup');

        expect(res.status).toBe(200);
        expect(res.body.data.signupToken).toMatch(/^[0-9a-f]{64}$/);
        expect(res.body.data.expiresIn).toBe(600);
        // Proving a number is not signing in.
        expect(String(res.headers['set-cookie'] ?? '')).not.toContain('token=');
    });

    test('a code issued for one purpose cannot be spent on the other', async () => {
        const phone = freshPhone();
        const otp = await sendAndRead(phone, 'signup');

        // Each purpose keeps its own pending code, so a signup code is not a login token and vice versa.
        const asLogin = await verify(phone, otp, 'login');

        expect(asLogin.status).toBe(400);
        expect(asLogin.body.error.code).toBe('OTP_NOT_FOUND');
    });
});

describe('creating the account (step 3)', () => {
    const details = () => ({
        name: 'Ravi Kumar',
        email: uniqueEmail('phonereg'),
        password: PASSWORD,
        role: 'farmer',
        village: 'Chandragiri',
        district: 'Tirupati',
        state: 'Andhra Pradesh',
    });

    async function provenPhone() {
        const phone = freshPhone();
        const otp = await sendAndRead(phone, 'signup');
        const res = await verify(phone, otp, 'signup');
        expect(res.status).toBe(200);
        return { phone, signupToken: res.body.data.signupToken };
    }

    test('a proven number creates an account with the number already verified', async () => {
        const { phone, signupToken } = await provenPhone();

        const res = await anon()
            .post('/api/v1/auth/phone/register')
            .send({ signupToken, ...details() });

        expect(res.status).toBe(201);
        expect(res.body.data.user.phone).toBe(phone);
        expect(res.body.data.user.role).toBe('farmer');

        const { rows } = await withDb((db) =>
            db.query('SELECT phone_verified, email_verified, village, district, state FROM users WHERE phone = $1', [phone]),
        );
        expect(rows[0].phone_verified).toBe(true);
        // The address was never proved, so it is not claimed to be.
        expect(rows[0].email_verified).toBe(false);
        expect(rows[0].district).toBe('Tirupati');
    });

    test('the new account can sign in by number straight away', async () => {
        const { phone, signupToken } = await provenPhone();
        await anon()
            .post('/api/v1/auth/phone/register')
            .send({ signupToken, ...details() })
            .expect(201);

        await clearResendHold(phone);
        const otp = await sendAndRead(phone, 'login');
        const res = await verify(phone, otp, 'login');

        expect(res.status).toBe(200);
        expect(res.body.data.user.phone).toBe(phone);
    });

    test('a signup token is single use', async () => {
        const { signupToken } = await provenPhone();
        await anon()
            .post('/api/v1/auth/phone/register')
            .send({ signupToken, ...details() })
            .expect(201);

        const again = await anon()
            .post('/api/v1/auth/phone/register')
            .send({ signupToken, ...details() });

        expect(again.status).toBe(400);
        expect(again.body.error.code).toBe('SIGNUP_TOKEN_INVALID');
    });

    test('an expired signup token cannot create an account', async () => {
        const { signupToken } = await provenPhone();
        // Ten minutes, expressed as the TTL expiring.
        await dropKey(`potp-signup:${signupToken}`);

        const res = await anon()
            .post('/api/v1/auth/phone/register')
            .send({ signupToken, ...details() });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('SIGNUP_TOKEN_INVALID');
    });

    test('an invented signup token cannot create an account', async () => {
        const res = await anon()
            .post('/api/v1/auth/phone/register')
            .send({ signupToken: crypto.randomBytes(32).toString('hex'), ...details() });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('SIGNUP_TOKEN_INVALID');
    });

    test('a weak password is refused, the same as anywhere else', async () => {
        const { signupToken } = await provenPhone();

        const res = await anon()
            .post('/api/v1/auth/phone/register')
            .send({ signupToken, ...details(), password: 'abc123' });

        expect(res.status).toBe(400);
    });
});
