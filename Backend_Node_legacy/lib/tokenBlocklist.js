/**
 * Backend/lib/tokenBlocklist.js
 *
 * Manages revoked JWT access tokens using a Redis-backed blocklist.
 * Includes an in-memory fallback for local development or when Redis is offline.
 * Hashes tokens (SHA-256) before storing to conserve space.
 */

const crypto = require('crypto');
const { redisClient } = require('../services/tracking-service/redisClient');
const logger = require('./logger');

// Fallback in-memory store for development/single-instance when Redis is offline
const memoryBlocklist = new Map();

// Periodic cleanup of expired memory blocklist entries
setInterval(() => {
    const now = Date.now();
    for (const [hash, expiresAt] of memoryBlocklist) {
        if (now > expiresAt) {
            memoryBlocklist.delete(hash);
        }
    }
}, 60 * 1000).unref(); // Run every minute, don't block process exit

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Add a token to the revocation blocklist.
 * @param {string} token - The raw JWT token
 * @param {number} exp - The expiration timestamp (in seconds since epoch)
 */
async function blockToken(token, exp) {
    if (!token || !exp) return;
    const hash = hashToken(token);
    const ttlSeconds = Math.max(0, exp - Math.floor(Date.now() / 1000));

    if (ttlSeconds <= 0) return; // Already expired naturally

    const redisKey = `bl:${hash}`;
    try {
        if (redisClient?.isReady) {
            await redisClient.set(redisKey, '1', { EX: ttlSeconds });
            return;
        }
    } catch (err) {
        logger.warn('[blocklist] Redis set failed, falling back to memory', { error: err.message });
    }

    // In-memory fallback
    memoryBlocklist.set(hash, Date.now() + ttlSeconds * 1000);
}

/**
 * Check if a token has been blocklisted.
 * @param {string} token - The raw JWT token
 * @returns {Promise<boolean>} True if blocklisted, false otherwise
 */
async function isBlocklisted(token) {
    if (!token) return false;
    const hash = hashToken(token);
    const redisKey = `bl:${hash}`;

    try {
        if (redisClient?.isReady) {
            const result = await redisClient.get(redisKey);
            return result !== null;
        }
    } catch (err) {
        logger.warn('[blocklist] Redis get failed, checking memory fallback', { error: err.message });
    }

    // Check in-memory fallback
    const expiresAt = memoryBlocklist.get(hash);
    if (expiresAt) {
        if (Date.now() <= expiresAt) {
            return true;
        }
        memoryBlocklist.delete(hash); // Clean up expired entry
    }

    return false;
}

module.exports = {
    blockToken,
    isBlocklisted,
};
