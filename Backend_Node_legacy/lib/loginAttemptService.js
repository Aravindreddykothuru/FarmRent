/**
 * Backend/middleware/loginAttemptService.js
 *
 * Progressive account lockout — Redis-backed.
 * Strategy: 5 failures → 15 min lock → next group of 3 → 30 min → 60 min → 24h
 */
const logger = require('../lib/logger');

// Progressive lockout durations (matches spec)
const LOCKOUT_MINUTES = [15, 30, 60, 1440];

let _redis = null;
function getRedis() {
    if (!_redis) {
        // Required lazily: redisClient loads after this module during app start-up.
        _redis = require('../services/tracking-service/redisClient').redisClient;
    }
    return _redis;
}

// ── In-memory fallback (per-process only; Redis is authoritative in production) ──
const _memState = new Map();

async function _incr(key) {
    const redis = getRedis();
    if (redis?.isReady) {
        const v = await redis.incr(key);
        if (v === 1) await redis.expire(key, 24 * 60 * 60); // reset TTL on first write
        return v;
    }
    const prev = _memState.get(key) || 0;
    _memState.set(key, prev + 1);
    return prev + 1;
}

async function _del(key) {
    const redis = getRedis();
    if (redis?.isReady) await redis.del(key).catch(() => {});
    _memState.delete(key);
}

async function _exists(key) {
    const redis = getRedis();
    if (redis?.isReady) return Boolean(await redis.exists(key).catch(() => 0));
    return _memState.has(key);
}

async function _setex(key, ttlSec, value = '1') {
    const redis = getRedis();
    if (redis?.isReady) {
        await redis.set(key, value, { EX: ttlSec }).catch(() => {});
    } else {
        _memState.set(key, value);
        setTimeout(() => _memState.delete(key), ttlSec * 1000);
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Call after a failed login attempt.
 * Returns { locked: boolean, lockUntilMs: number, failCount: number }
 */
async function recordFailure(email) {
    const norm = email.trim().toLowerCase();
    const failKey = `login_fail:${norm}`;
    const lockKey = `lock:${norm}`;

    const failures = await _incr(failKey);

    if (failures >= 5) {
        // Determine which lockout tier to apply
        const tierIndex = Math.min(Math.floor((failures - 5) / 3), LOCKOUT_MINUTES.length - 1);
        const lockMinutes = LOCKOUT_MINUTES[tierIndex];
        const lockSec = lockMinutes * 60;

        await _setex(lockKey, lockSec);

        logger.warn('[loginAttempt] Account locked', {
            email: norm,
            failCount: failures,
            lockMinutes,
        });

        // Security alert (non-blocking): the lock is already in place, so a delivery failure is logged, not raised.
        const emailService = require('./emailService');
        Promise.resolve()
            .then(() =>
                emailService.send({
                    to: email,
                    subject: '🔒 FarmRent Security Alert: Account Temporarily Locked',
                    html: `<p>Your FarmRent account was temporarily locked due to ${failures} failed login attempts.
                It will unlock after ${lockMinutes >= 1440 ? '24 hours' : `${lockMinutes} minutes`}.</p>
                <p>If this was not you, please reset your password immediately.</p>`,
                }),
            )
            .catch((err) => logger.warn('[loginAttempt] lock alert email failed', { email: norm, error: err.message }));

        return { locked: true, lockMinutes, failCount: failures };
    }

    return { locked: false, lockMinutes: 0, failCount: failures };
}

/**
 * Check if an account is currently locked.
 * Returns { locked: boolean, retryAfterSec: number }
 */
async function isLocked(email) {
    const norm = email.trim().toLowerCase();
    const lockKey = `lock:${norm}`;
    const locked = await _exists(lockKey);

    if (!locked) return { locked: false, retryAfterSec: 0 };

    let retryAfterSec = 60; // default if we can't fetch TTL
    const redis = getRedis();
    if (redis?.isReady) {
        const ttl = await redis.ttl(lockKey).catch(() => -1);
        if (ttl > 0) retryAfterSec = ttl;
    }

    return { locked: true, retryAfterSec };
}

/**
 * Clear all failure tracking for an email (call on successful login).
 */
async function clearFailures(email) {
    const norm = email.trim().toLowerCase();
    await _del(`login_fail:${norm}`);
    // Do NOT clear the lock key here; it should expire naturally.
    // (Clearing on success would allow an attacker to reset lock by guessing correctly once.)
}

module.exports = { recordFailure, isLocked, clearFailures };
