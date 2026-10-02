/**
 * Backend/middleware/slidingWindowRateLimiter.js
 *
 * Sliding-window rate limiter using Redis sorted sets.
 * Matches the spec: uses ZSET timestamps, removes old members outside the window.
 * Falls back to in-memory when Redis is unavailable.
 */
const crypto = require('crypto');
const logger = require('../lib/logger');

let _redis = null;
function getRedis() {
    if (!_redis) {
        // Required lazily: redisClient loads after this module during app start-up.
        _redis = require('../services/tracking-service/redisClient').redisClient;
    }
    return _redis?.isReady ? _redis : null;
}

// ── In-memory sliding window fallback ─────────────────────────────────────
const _memWindows = new Map(); // key → [{score, member}]

function _memCount(key, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const entries = (_memWindows.get(key) || []).filter((e) => e.score > cutoff);
    _memWindows.set(key, entries);
    return entries.length;
}

function _memAdd(key, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const entries = (_memWindows.get(key) || []).filter((e) => e.score > cutoff);
    entries.push({ score: now, member: crypto.randomUUID() });
    _memWindows.set(key, entries);
}

// ── Core sliding-window check ─────────────────────────────────────────────

/**
 * Returns true if the request is allowed, false if rate-limited.
 * @param {string} key    - Unique rate-limit key (e.g. "otp:user@email.com")
 * @param {number} maxRequests
 * @param {number} windowMs
 */
async function isAllowed(key, maxRequests, windowMs) {
    const redis = getRedis();
    const redisKey = `rl:${key}`;

    if (redis) {
        try {
            const now = Date.now();
            const cutoff = now - windowMs;
            const windowSec = Math.ceil(windowMs / 1000);

            await redis.zRemRangeByScore(redisKey, 0, cutoff);
            const count = await redis.zCard(redisKey);

            if (count >= maxRequests) return false;

            await redis.zAdd(redisKey, { score: now, value: crypto.randomUUID() });
            await redis.expire(redisKey, windowSec);
            return true;
        } catch (err) {
            logger.warn('[slidingRateLimiter] Redis error, falling back to memory', { error: err.message });
        }
    }

    // In-memory fallback
    const count = _memCount(key, windowMs);
    if (count >= maxRequests) return false;
    _memAdd(key, windowMs);
    return true;
}

/**
 * Express middleware factory.
 * @param {{ keyFn: (req) => string, maxRequests: number, windowMs: number, message?: string }} opts
 */
function slidingWindowLimiter({ keyFn, maxRequests, windowMs, message = 'Too many requests. Please try again later.' } = {}) {
    return async (req, res, next) => {
        try {
            const key = keyFn(req);
            const allowed = await isAllowed(key, maxRequests, windowMs);
            if (!allowed) {
                return res.status(429).json({
                    success: false,
                    error: {
                        code: 'RATE_LIMIT_EXCEEDED',
                        message,
                        details: { retryAfterSeconds: Math.ceil(windowMs / 1000) },
                    },
                });
            }
            next();
        } catch (err) {
            logger.error('[slidingRateLimiter] Unexpected error — failing open', { error: err.message });
            next(); // fail-open for availability
        }
    };
}

// ── Pre-built limiters matching spec ─────────────────────────────────────

/** 3 OTP sends per 15 minutes per email */
const otpSendLimiter = slidingWindowLimiter({
    keyFn: (req) => `otp:send:${(req.body?.email || req.body?.phone || req.ip || 'unknown').toLowerCase()}`,
    maxRequests: process.env.NODE_ENV === 'production' ? 3 : 20,
    windowMs: 15 * 60 * 1000,
    message: 'Too many OTP requests. Try again in 15 minutes.',
});

/** 5 verify attempts per 10 minutes per email/user */
const otpVerifyLimiter = slidingWindowLimiter({
    keyFn: (req) => `otp:verify:${(req.body?.email || req.user?.id || req.ip || 'unknown').toLowerCase()}`,
    maxRequests: process.env.NODE_ENV === 'production' ? 5 : 50,
    windowMs: 10 * 60 * 1000,
    message: 'Too many OTP verification attempts. Please request a new OTP.',
});

/** 5 login attempts per 5 minutes per IP */
const loginIpLimiter = slidingWindowLimiter({
    keyFn: (req) => `login:ip:${req.ip || 'unknown'}`,
    maxRequests: process.env.NODE_ENV === 'production' ? 20 : 200,
    windowMs: 5 * 60 * 1000,
    message: 'Too many login attempts from this IP. Please try again in 5 minutes.',
});

/** 5 password reset attempts per hour per IP (Module 5.1 rate limiting) */
const passwordResetLimiter = slidingWindowLimiter({
    keyFn: (req) => `pwdreset:ip:${req.ip || 'unknown'}`,
    maxRequests: process.env.NODE_ENV === 'production' ? 5 : 50,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Too many password reset attempts from this IP. Please try again in an hour.',
});

module.exports = { isAllowed, slidingWindowLimiter, otpSendLimiter, otpVerifyLimiter, loginIpLimiter, passwordResetLimiter };
