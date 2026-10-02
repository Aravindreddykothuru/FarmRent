const { createClient } = require('redis');
const logger = require('../../lib/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Exponential back-off config for startup ping loop
const MAX_STARTUP_RETRIES = 8;
const INITIAL_DELAY_MS = 200; // first retry after 200 ms
const MAX_DELAY_MS = 5000; // cap each delay at 5 s

// 1. Standard Client for Geospatial queries (GEOADD, GEORADIUS)
const redisClient = createClient({ url: REDIS_URL });

// 2. Publisher Client for broadcasting real-time updates
const pubClient = redisClient.duplicate();

// 3. Subscriber Client for listening to updates across instances
const subClient = redisClient.duplicate();

// ── Error handlers ────────────────────────────────────────────────────────────
// Downgrade pre-ready errors to WARN so Docker startup timing noise is not
// logged as a hard ERROR.  After successful connection these become true errors.
let redisReady = false;

function makeErrorHandler(name) {
    return (err) => {
        if (!redisReady) {
            logger.warn(`[redis] ${name} reconnecting — ${err.message}`);
        } else {
            logger.error(`[redis] ${name} error`, { error: err.message });
        }
    };
}

redisClient.on('error', makeErrorHandler('redisClient'));
pubClient.on('error', makeErrorHandler('pubClient'));
subClient.on('error', makeErrorHandler('subClient'));

let hasGeoSupport = true; // Default to true, detect on connect

/**
 * Wait for a Redis client to be reachable with exponential back-off.
 * Returns once the client responds to PING, or throws after MAX_STARTUP_RETRIES.
 */
async function waitForRedis(client, label) {
    for (let attempt = 1; attempt <= MAX_STARTUP_RETRIES; attempt++) {
        try {
            if (!client.isOpen) await client.connect();
            await client.ping(); // lightweight readiness probe
            return; // success
        } catch (err) {
            const delay = Math.min(INITIAL_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
            if (attempt < MAX_STARTUP_RETRIES) {
                logger.warn(
                    `[redis] ${label} not ready (attempt ${attempt}/${MAX_STARTUP_RETRIES}). ` + `Retrying in ${delay} ms — ${err.message}`,
                );
                await new Promise((r) => setTimeout(r, delay));
            } else {
                throw new Error(`[redis] ${label} unreachable after ${MAX_STARTUP_RETRIES} attempts: ${err.message}`);
            }
        }
    }
}

const connectRedis = async () => {
    try {
        // Connect all three clients with graceful startup back-off
        await waitForRedis(redisClient, 'redisClient');
        await waitForRedis(pubClient, 'pubClient');
        await waitForRedis(subClient, 'subClient');

        redisReady = true; // from here, errors are real errors

        // Detect version for Geo support
        try {
            const info = await redisClient.info('server');
            const versionMatch = info.match(/redis_version:([0-9.]+)/);
            if (versionMatch) {
                const version = versionMatch[1];
                const [major, minor] = version.split('.').map(Number);
                if (major < 3 || (major === 3 && minor < 2)) {
                    hasGeoSupport = false;
                    logger.warn(`[redis] Server version ${version} is < 3.2. Disabling GEO support.`);
                } else {
                    logger.info(`[redis] Server version ${version} supports GEO commands.`);
                }
            }
        } catch (vErr) {
            logger.warn('[redis] Failed to detect version:', { error: vErr.message });
        }

        logger.info('Connected to Redis (Data, Pub, Sub)');
    } catch (error) {
        // Single WARN after all retries exhausted — app degrades gracefully without Redis
        logger.warn('[redis] Failed to connect to Redis after retries', { error: error.message });
    }
};

module.exports = {
    connectRedis,
    redisClient,
    pubClient,
    subClient,
    getHasGeoSupport: () => hasGeoSupport,
};
