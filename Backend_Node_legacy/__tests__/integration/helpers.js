/**
 * Shared helpers for integration tests: the real Express app, real Postgres (via PostgREST) and Redis.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { Client } = require('pg');
const { createClient } = require('redis');
const { ROLE_IDS } = require('../../lib/roles');

const PASSWORD = 'Test@12345';
let app;

function getApp() {
    if (!app) {
        const { connectRedis } = require('../../services/tracking-service/redisClient');
        connectRedis();
        const { buildBackendApplication } = require('../../app');
        app = buildBackendApplication();
    }
    return app;
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

/** Clears rate-limit and lockout counters so repeated local runs start from a clean slate. */
async function resetRateLimits() {
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

const uniqueEmail = (label) => `${label}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}@test.farmrent.local`;
const randomPhone = () => `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;

/** Calendar date `offset` days from today (UTC), as YYYY-MM-DD. */
const isoDate = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function createUser(role = 'farmer', name = `Test ${role}`) {
    const email = uniqueEmail(role);
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    return withDb(async (db) => {
        const { rows } = await db.query(
            `INSERT INTO users (email, full_name, phone, password_hash, email_verified)
             VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
            [email, name, randomPhone(), passwordHash],
        );
        await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [rows[0].id, ROLE_IDS[role]]);
        return { id: rows[0].id, email, password: PASSWORD, role, name };
    });
}

/** Signs a user in through the API and returns a supertest agent carrying their session cookies. */
async function login(user) {
    const agent = request.agent(getApp());
    const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    if (res.status !== 200) throw new Error(`login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
    return agent;
}

async function createEquipment(ownerId, overrides = {}) {
    return withDb(async (db) => {
        const { rows } = await db.query(
            `INSERT INTO equipment (owner_id, name, category, daily_rate, deposit_amount, district, state, latitude, longitude,
                                    pickup_lat, pickup_lng, pickup_address, status, is_verified)
             VALUES ($1, $2, $3, $4, $5, 'Anantapur', 'Andhra Pradesh', 14.68, 77.6, 14.681, 77.601, 'Owner yard, Anantapur', 'active', TRUE)
             RETURNING id`,
            [
                ownerId,
                overrides.name || `Test Tractor ${crypto.randomBytes(2).toString('hex')}`,
                overrides.category || 'tractor',
                overrides.dailyRate ?? 1000,
                overrides.deposit ?? 500,
            ],
        );
        return rows[0].id;
    });
}

module.exports = { PASSWORD, getApp, withDb, resetRateLimits, uniqueEmail, randomPhone, isoDate, createUser, login, createEquipment };
