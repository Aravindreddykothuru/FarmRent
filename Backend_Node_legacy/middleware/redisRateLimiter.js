const { redisClient } = require('../services/tracking-service/redisClient');
const logger = require('../lib/logger');

/**
 * Fixed-window rate limiter backed by Redis.
 * `name` namespaces the counter: several limiters can guard the same URL (for example the auth router's limiter
 * and the login route's own limiter on /api/v1/auth/login) and each must count a request exactly once.
 */
function createRateLimiter({ name, windowMs = 60 * 1000, max = 10, message = 'Too many requests' } = {}) {
    if (!name) throw new Error('createRateLimiter requires a name');

    return async (req, res, next) => {
        // Fail-open gracefully if Redis client is not connected or ready
        if (!redisClient || !redisClient.isReady) {
            return next();
        }

        try {
            const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${ip}`;
            // One counter per limiter + base URL + path + identifier
            const key = `rate_limit:${name}:${req.baseUrl || ''}:${req.path || ''}:${identifier}`;

            const current = await redisClient.incr(key);

            if (current === 1) {
                // Set TTL in seconds
                const ttl = Math.ceil(windowMs / 1000);
                await redisClient.expire(key, ttl);
            }

            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, max - current));

            if (current > max) {
                return res.status(429).json({
                    status: 'error',
                    message,
                });
            }

            next();
        } catch (err) {
            logger.error('[redisRateLimiter] Error:', { error: err.message });
            // Fail-open on Redis errors
            next();
        }
    };
}

const authLimiter = createRateLimiter({
    name: 'auth',
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many requests, please try again later.',
});

const paymentLimiter = createRateLimiter({
    name: 'payment',
    windowMs: 60 * 1000,
    max: 10,
    message: 'Payment rate limit exceeded.',
});

const generalLimiter = createRateLimiter({
    name: 'general',
    windowMs: 60 * 1000,
    max: 120,
    message: 'Too many requests.',
});

const otpLimiter = createRateLimiter({
    name: 'otp',
    windowMs: 10 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 3 : 20,
    message: 'Too many OTP requests. Please wait before trying again.',
});

const loginLimiter = createRateLimiter({
    name: 'login',
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: process.env.NODE_ENV === 'production' ? 5 : 50, // 50 in dev, 5 in prod
    message: 'Too many login attempts. Please try again after 5 minutes.',
});

const bookingLimiter = createRateLimiter({
    name: 'booking',
    windowMs: 60 * 1000, // 1 minute
    max: 3,
    message: 'Too many booking requests. Please wait a minute.',
});

const searchLimiter = createRateLimiter({
    name: 'search',
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: 'Too many search requests. Please slow down.',
});

module.exports = {
    createRateLimiter,
    authLimiter,
    paymentLimiter,
    generalLimiter,
    otpLimiter,
    loginLimiter,
    bookingLimiter,
    searchLimiter,
};
