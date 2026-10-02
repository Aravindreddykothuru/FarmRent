const request = require('supertest');
const { getApp } = require('./helpers');

describe('operational endpoints and HTTP behaviour', () => {
    const app = () => getApp();

    test('GET /health reports liveness', async () => {
        const res = await request(app()).get('/health').expect(200);
        expect(res.body).toMatchObject({ status: 'ok', service: 'API Gateway' });
    });

    test('GET /health/full proves the database answers', async () => {
        const res = await request(app()).get('/health/full').expect(200);
        expect(res.body.status).toBe('healthy');
        expect(res.body.dependencies.database.reachable).toBe(true);
    });

    test('GET /metrics exposes Prometheus metrics', async () => {
        const res = await request(app()).get('/metrics').expect(200);
        expect(res.text).toContain('http_requests_total');
    });

    test('invalid login payload is a 400 with field details, not a 500', async () => {
        const res = await request(app()).post('/api/v1/auth/login').send({ email: 'not-an-email', password: '' }).expect(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toBe('Validation failed');
        expect(res.body.error.details.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['email', 'password']));
    });

    test('malformed JSON is a clean 400', async () => {
        const res = await request(app()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400);
        expect(res.body.error.code).toBe('INVALID_JSON');
    });

    test('unknown endpoints return a JSON 404', async () => {
        const res = await request(app()).get('/api/v1/does-not-exist').expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
    });

    test('protected endpoints reject requests without a token', async () => {
        const res = await request(app()).get('/api/v1/bookings/my').expect(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('a forged token is rejected', async () => {
        await request(app()).get('/api/v1/auth/me').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad').expect(401);
    });

    test('CORS allows the app origin and refuses unknown origins', async () => {
        const allowed = await request(app()).get('/health').set('Origin', 'http://localhost:3000');
        expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
        expect(allowed.headers['access-control-allow-credentials']).toBe('true');

        const denied = await request(app()).get('/api/v1/machines').set('Origin', 'https://evil.example').expect(403);
        expect(denied.headers['access-control-allow-origin']).toBeUndefined();
        expect(denied.body.error.code).toBe('CORS_ORIGIN_DENIED');
    });

    test('KYC uploads are never served as static files', async () => {
        await request(app()).get('/uploads/kyc/anything.pdf').expect(404);
    });

    test('the public PostgREST endpoint denies the anonymous role', async () => {
        const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?select=id`);
        expect(res.status).toBe(401);
    });
});
