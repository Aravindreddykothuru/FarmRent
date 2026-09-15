const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { createBullBoard } = require('@bull-board/api');
const { ExpressAdapter } = require('@bull-board/express');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const logger = require('./logger');

const redisUrl = process.env.REDIS_URL;
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const hasRedisUrl = !!redisUrl;

let connection = null;
let queuesInitialized = false;

// Proxy utility for safe fallback before connection is ready or if queues are disabled
function createQueueProxy(name) {
    let queue = null;
    return new Proxy(
        {},
        {
            get(target, prop) {
                if (prop === 'raw') {
                    return queue;
                }
                if (prop === 'add') {
                    return (...args) => {
                        if (queue) {
                            return queue.add(...args);
                        } else {
                            logger.warn(`[queue-manager] Queue "${name}" is not ready. Action dropped.`);
                            return Promise.resolve(null);
                        }
                    };
                }
                if (queue) {
                    return typeof queue[prop] === 'function' ? queue[prop].bind(queue) : queue[prop];
                }
                return undefined;
            },
            set(target, prop, value) {
                if (prop === 'raw') {
                    queue = value;
                    return true;
                }
                return false;
            },
        },
    );
}

// Pre-define queues using safe proxies
const emailQueue = createQueueProxy('emails');
const notificationQueue = createQueueProxy('notifications');
const invoiceQueue = createQueueProxy('invoices');
const cleanupQueue = createQueueProxy('cleanups');
const reminderQueue = createQueueProxy('reminders');
const imageQueue = createQueueProxy('images');

// Set up Bull Board adapter router
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/api/v1/admin/queues');

async function checkRedisVersion(client, serviceName) {
    try {
        if (!client) return false;
        const info = await client.info();
        const match = info.match(/redis_version:([0-9.]+)/);
        if (match) {
            const version = match[1];
            const major = parseInt(version.split('.')[0], 10);
            if (major < 5) {
                logger.warn(`[Startup] ${serviceName}: Redis version ${version} is < 5.0.0. Disabling background queues.`);
                return false;
            }
        }
        return true;
    } catch (err) {
        logger.warn(`[Startup] ${serviceName}: Failed to verify Redis version:`, { error: err.message });
        return false;
    }
}

if (isDev && !hasRedisUrl) {
    logger.warn('[Startup] REDIS_URL is unset. Background queues are disabled.');
} else {
    const targetUrl = redisUrl || 'redis://127.0.0.1:6379';
    let everConnected = false;
    let loggedRedisDown = false;

    try {
        connection = new IORedis(targetUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            // `times` counts attempts since the last successful connection. Give up only when Redis was never
            // reachable at start-up (avoids an endless retry loop); once connected, keep reconnecting through outages.
            retryStrategy(times) {
                if (!everConnected && times >= 5) {
                    if (!loggedRedisDown) {
                        logger.warn('[Startup] Redis is unreachable after maximum attempts. Background queues disabled.');
                        loggedRedisDown = true;
                    }
                    return null;
                }
                return Math.min(times * 200, 3000); // Capped backoff
            },
        });
        connection.once('ready', () => {
            everConnected = true;
        });

        connection.on('ready', async () => {
            if (queuesInitialized) return;
            queuesInitialized = true;

            const versionOk = await checkRedisVersion(connection, 'queue-manager');
            if (!versionOk) {
                if (connection) {
                    connection.removeAllListeners();
                    try {
                        connection.disconnect();
                    } catch (_) {
                        /* socket already closed — nothing left to release */
                    }
                    connection = null;
                }
                return;
            }

            logger.info('[Startup] Redis: connected | Queues: enabled');

            // Instantiate raw BullMQ queues and wire them into the proxies
            const defaultJobOptions = {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: 100,
            };

            try {
                emailQueue.raw = new Queue('emails', { connection, defaultJobOptions });
                notificationQueue.raw = new Queue('notifications', { connection, defaultJobOptions });
                invoiceQueue.raw = new Queue('invoices', { connection, defaultJobOptions });
                cleanupQueue.raw = new Queue('cleanups', { connection, defaultJobOptions });
                reminderQueue.raw = new Queue('reminders', { connection, defaultJobOptions });
                imageQueue.raw = new Queue('images', { connection, defaultJobOptions });

                createBullBoard({
                    queues: [
                        new BullMQAdapter(emailQueue.raw),
                        new BullMQAdapter(notificationQueue.raw),
                        new BullMQAdapter(invoiceQueue.raw),
                        new BullMQAdapter(cleanupQueue.raw),
                        new BullMQAdapter(reminderQueue.raw),
                        new BullMQAdapter(imageQueue.raw),
                    ],
                    serverAdapter: serverAdapter,
                });

                // Initialize background workers ONLY after version verification passes
                try {
                    const { initInvoiceWorker } = require('../workers/invoiceWorker');
                    const { initCronWorkers } = require('../workers/cronWorker');
                    const { initImageWorker } = require('../workers/imageWorker');
                    initInvoiceWorker();
                    initCronWorkers();
                    initImageWorker();
                } catch (wErr) {
                    logger.warn(`[Startup] Workers initialization skipped: ${wErr.message}`);
                }
            } catch (err) {
                logger.warn(`[Startup] BullMQ initialization skipped: ${err.message}. Background queues disabled.`);
            }
        });

        connection.on('error', (err) => {
            if (!loggedRedisDown) {
                logger.warn('[queue-manager] Redis connection error:', { error: err.message });
            }
        });
    } catch (err) {
        logger.error('[queue-manager] Redis initialization failed:', { error: err.message });
    }
}

module.exports = {
    emailQueue,
    notificationQueue,
    invoiceQueue,
    cleanupQueue,
    reminderQueue,
    imageQueue,
    queuesRouter: serverAdapter.getRouter(),
    connection,
};
