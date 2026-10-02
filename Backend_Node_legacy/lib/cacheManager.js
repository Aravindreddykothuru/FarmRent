/**
 * Backend/lib/cacheManager.js
 *
 * Unified cache manager utility wrapping the existing redisClient.
 * Provides cache-aside pattern (remember), single key get/set, and pattern-based invalidation.
 * Includes fallback to no-op/in-memory if Redis is offline.
 */

const { redisClient } = require('../services/tracking-service/redisClient');
const logger = require('./logger');

// Local in-memory store fallback when Redis is offline (for resilience)
const memoryCache = new Map();

// Periodic cleanup of expired memory cache entries
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memoryCache) {
        if (now > v.expiresAt) memoryCache.delete(k);
    }
}, 60 * 1000).unref();

const defaultTTL = parseInt(process.env.REDIS_DEFAULT_TTL, 10) || 300; // 5 minutes

/**
 * Get value from cache
 */
async function get(key) {
    try {
        if (redisClient?.isReady) {
            const raw = await redisClient.get(key);
            return raw ? JSON.parse(raw) : null;
        }
    } catch (err) {
        logger.warn('[cache] Redis GET failed, checking fallback', { key, error: err.message });
    }

    // Fallback
    const entry = memoryCache.get(key);
    if (entry) {
        if (Date.now() <= entry.expiresAt) return entry.value;
        memoryCache.delete(key);
    }
    return null;
}

/**
 * Set value in cache
 */
async function set(key, value, ttlSeconds = defaultTTL) {
    try {
        if (redisClient?.isReady) {
            await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
            return true;
        }
    } catch (err) {
        logger.warn('[cache] Redis SET failed, saving to fallback', { key, error: err.message });
    }

    // Fallback
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return true;
}

/**
 * Delete key from cache
 */
async function del(key) {
    try {
        if (redisClient?.isReady) {
            await redisClient.del(key);
            return;
        }
    } catch (err) {
        logger.warn('[cache] Redis DEL failed', { key, error: err.message });
    }
    memoryCache.delete(key);
}

/**
 * Cache-aside helper
 * Returns cached item, or runs fn, caches result, and returns it.
 */
async function remember(key, ttlSeconds, fn) {
    const cached = await get(key);
    if (cached !== null) {
        return cached;
    }

    const freshData = await fn();
    if (freshData !== undefined && freshData !== null) {
        await set(key, freshData, ttlSeconds);
    }
    return freshData;
}

/**
 * Invalidate all keys matching a pattern (e.g. "user:profile:*")
 */
async function invalidatePattern(pattern) {
    try {
        if (redisClient?.isReady) {
            const keys = [];
            for await (const key of redisClient.scanIterator({
                MATCH: pattern,
                COUNT: 100,
            })) {
                keys.push(key);
            }
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
            return;
        }
    } catch (err) {
        logger.warn('[cache] Redis pattern invalidation failed', { pattern, error: err.message });
    }

    // Fallback in-memory pattern match
    const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    for (const key of memoryCache.keys()) {
        if (regex.test(key)) {
            memoryCache.delete(key);
        }
    }
}

module.exports = {
    get,
    set,
    del,
    remember,
    invalidatePattern,
};
