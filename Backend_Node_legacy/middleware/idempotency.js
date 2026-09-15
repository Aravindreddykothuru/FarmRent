const logger = require('../lib/logger');
const { redisClient } = require('../services/tracking-service/redisClient');

function idempotency() {
    return async (req, res, next) => {
        // Enforce on mutation requests (POST, PUT, PATCH, DELETE)
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            return next();
        }

        const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
        if (!key) {
            return res.status(400).json({
                status: 'error',
                message: 'Idempotency-Key header is required for this transactional request.',
            });
        }

        // Validate key format (alphanumeric, hyphens, UUID, 8 to 128 chars)
        if (!/^[a-zA-Z0-9\-_:]{8,128}$/.test(key)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid Idempotency-Key format. Must be alphanumeric with hyphens, underscores, or colons.',
            });
        }

        // If Redis is not ready, warn and bypass (fail-open to avoid service outage)
        if (!redisClient?.isReady) {
            logger.warn('[idempotency] Redis client not ready, bypassing check');
            return next();
        }

        const lockKey = `lock:idemp:${key}`;
        const respKey = `resp:idemp:${key}`;

        try {
            // Check if we already have a cached response
            const cached = await redisClient.get(respKey);
            if (cached) {
                const { status, body } = JSON.parse(cached);
                logger.info('[idempotency] Returning cached response', { key });
                return res.status(status).json(body);
            }

            // Attempt to acquire a lock (expire in 2 minutes to prevent deadlocks)
            // NX: Set if not exists
            const acquired = await redisClient.set(lockKey, 'started', { NX: true, EX: 120 });
            if (!acquired) {
                logger.warn('[idempotency] Request already in progress', { key });
                return res.status(409).json({
                    status: 'error',
                    message: 'A duplicate request with this Idempotency-Key is already in progress.',
                });
            }

            // Capture the response to cache it
            const originalJson = res.json;
            res.json = function (body) {
                // Store in Redis (24-hour expiry)
                const responseData = {
                    status: res.statusCode,
                    body: body,
                };
                redisClient
                    .set(respKey, JSON.stringify(responseData), { EX: 86400 })
                    .catch((e) => logger.error('[idempotency] Failed to cache response', { error: e.message }));

                // Release the lock
                redisClient.del(lockKey).catch((e) => logger.error('[idempotency] Failed to release lock', { error: e.message }));

                return originalJson.call(this, body);
            };

            next();
        } catch (err) {
            logger.error('[idempotency] Error in middleware', { error: err.message });
            next(err);
        }
    };
}

module.exports = { idempotency };
