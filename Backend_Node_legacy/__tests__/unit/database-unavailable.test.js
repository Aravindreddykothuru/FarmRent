/**
 * A database that cannot be reached is an outage, and has to be reported as one.
 *
 * The production database went away while the application kept running. supabase-js does not throw when its
 * request never arrives: it resolves with a plain object, which every route throws exactly as it would a
 * constraint violation. The error handler did not recognise it, so for weeks every listing, every sign-in and
 * the landing-page totals answered 500 "Unexpected server error" — the wording of a bug, on a site whose code
 * was fine.
 *
 * The handler is exercised through a real Express app, envelope included, because the wording and the status
 * are what a person and a monitor actually receive.
 */
const express = require('express');
const request = require('supertest');
const { errorHandler, isDatabaseUnreachable } = require('../../middleware/errorHandler');
const { responseEnvelope } = require('../../middleware/responseEnvelope');
const { HttpError } = require('../../lib/httpError');

/** What supabase-js 2.x hands back when fetch itself fails (DNS, refused, reset). */
const FETCH_FAILED = {
    message: 'TypeError: fetch failed',
    details: 'TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND project.supabase.co (ENOTFOUND)',
    hint: '',
    code: '',
};

function appThatThrows(err) {
    const app = express();
    app.use(responseEnvelope());
    app.get('/thing', (_req, _res, next) => next(err));
    app.use(errorHandler);
    return app;
}

describe('database unreachable', () => {
    let previousEnv;
    beforeAll(() => {
        previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
    });
    afterAll(() => {
        process.env.NODE_ENV = previousEnv;
    });

    test('a query that never reached the database answers 503 DB_UNAVAILABLE, not 500', async () => {
        const res = await request(appThatThrows(FETCH_FAILED)).get('/thing').expect(503);

        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('DB_UNAVAILABLE');
        expect(res.body.error.message).toMatch(/temporarily unavailable/i);
        expect(res.headers['retry-after']).toBe('30');
    });

    test('nothing about the failure leaks: no host name, no stack', async () => {
        const res = await request(appThatThrows(FETCH_FAILED)).get('/thing').expect(503);

        const text = JSON.stringify(res.body);
        expect(text).not.toContain('supabase.co');
        expect(text).not.toContain('ENOTFOUND');
        expect(res.body.error.details).toEqual({});
    });

    test.each(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])(
        'PostgREST reporting that it has no database connection (%s) is the same outage',
        async (code) => {
            const err = { code, message: 'Could not connect with the database', details: null, hint: null };
            const res = await request(appThatThrows(err)).get('/thing').expect(503);
            expect(res.body.error.code).toBe('DB_UNAVAILABLE');
        },
    );

    test('an ordinary database error is still an unexpected 500', async () => {
        const constraint = { code: '23505', message: 'duplicate key value violates unique constraint', details: 'Key exists', hint: '' };
        const res = await request(appThatThrows(constraint)).get('/thing').expect(500);
        expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    test('a failed fetch thrown by our own code is not mistaken for the database', async () => {
        // Calls to SMS, email and weather providers throw real Error instances; only supabase-js resolves with
        // a plain object. A provider being down must not be announced as the whole site being down.
        const providerDown = new TypeError('fetch failed');
        expect(isDatabaseUnreachable(providerDown)).toBe(false);
        await request(appThatThrows(providerDown)).get('/thing').expect(500);
    });

    test('deliberate answers pass through untouched', async () => {
        const res = await request(appThatThrows(new HttpError(409, 'BOOKING_CONFLICT', 'Those dates are taken')))
            .get('/thing')
            .expect(409);
        expect(res.body.error.code).toBe('BOOKING_CONFLICT');
    });

    test.each([null, undefined, 'fetch failed', 42])('non-object input %p is not a database outage', (value) => {
        expect(isDatabaseUnreachable(value)).toBe(false);
    });
});
