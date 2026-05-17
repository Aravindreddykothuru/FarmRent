const { createClient } = require('redis');
const logger = require('../../lib/logger');

// 1. Standard Client for Geospatial queries (GEOADD, GEORADIUS)
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// 2. Publisher Client for broadcasting real-time updates
const pubClient = redisClient.duplicate();

// 3. Subscriber Client for listening to updates across instances
const subClient = redisClient.duplicate();

redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
pubClient.on('error', (err) => logger.error('Redis Pub Client Error', { error: err.message }));
subClient.on('error', (err) => logger.error('Redis Sub Client Error', { error: err.message }));

let hasGeoSupport = true; // Default to true, detect on connect

const connectRedis = async () => {
    try {
        await redisClient.connect();
        await pubClient.connect();
        await subClient.connect();
        
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
        logger.error('Failed to connect to Redis', { error: error.message });
    }
};

module.exports = {
    connectRedis,
    redisClient,
    pubClient,
    subClient,
    getHasGeoSupport: () => hasGeoSupport
};
