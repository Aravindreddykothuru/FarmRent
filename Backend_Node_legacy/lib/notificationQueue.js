/**
 * Backend/lib/notificationQueue.js
 *
 * Queue manager for asynchronous fire-and-forget notification delivery.
 * Pushes notification requests to a BullMQ Redis queue or in-memory fallback,
 * allowing the calling thread to return immediately. A worker process loops and pops tasks.
 */

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('./logger');

const redisUrl = process.env.REDIS_URL;
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const hasRedisUrl = !!redisUrl;

let connection = null;
let notificationQueue = null;
let worker = null;

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
    // Queues disabled, handled gracefully in memory queue fallback
} else {
    const targetUrl = redisUrl || 'redis://127.0.0.1:6379';
    let everConnected = false;
    let loggedRedisDown = false;

    try {
        connection = new IORedis(targetUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            // `times` counts attempts since the last successful connection. Give up only when Redis was never
            // reachable at start-up; once connected, keep reconnecting through outages with capped backoff.
            retryStrategy(times) {
                if (!everConnected && times >= 5) {
                    if (!loggedRedisDown) {
                        logger.warn(
                            '[notification-queue] Redis is unreachable after maximum attempts. Background notification queue disabled.',
                        );
                        loggedRedisDown = true;
                    }
                    return null;
                }
                return Math.min(times * 200, 3000);
            },
        });
        connection.once('ready', () => {
            everConnected = true;
        });

        connection.on('ready', async () => {
            if (notificationQueue) return;

            const versionOk = await checkRedisVersion(connection, 'notification-queue');
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

            try {
                notificationQueue = new Queue('notifications', {
                    connection,
                    defaultJobOptions: {
                        attempts: 5,
                        backoff: {
                            type: 'exponential',
                            delay: 5000,
                        },
                        removeOnComplete: true,
                        removeOnFail: 100,
                    },
                });

                worker = new Worker(
                    'notifications',
                    async (job) => {
                        const { userId, payload } = job.data;
                        await processNotificationInline(userId, payload);
                    },
                    {
                        connection,
                        concurrency: 5,
                    },
                );

                worker.on('failed', (job, err) => {
                    const loggedErrors = global.loggedWorkerErrors || (global.loggedWorkerErrors = new Set());
                    const errKey = `notification:${err.message}`;
                    if (!loggedErrors.has(errKey)) {
                        logger.error(`[notification-queue] Job ${job?.id} failed: ${err.message}`);
                        loggedErrors.add(errKey);
                    }
                });

                process.once('SIGTERM', () => worker.close().catch(() => {}));
                process.once('SIGINT', () => worker.close().catch(() => {}));
            } catch (err) {
                logger.warn(`[notification-queue] BullMQ initialization skipped: ${err.message}`);
                connection.disconnect();
                connection = null;
            }
        });

        connection.on('error', (err) => {
            if (!loggedRedisDown) {
                logger.warn('[notification-queue] Redis connection error:', { error: err.message });
            }
        });
    } catch (err) {
        logger.warn('[notification-queue] Redis initialization failed:', { error: err.message });
    }
}

// Local memory queue fallback if Redis is unavailable
const memoryQueue = [];
let isProcessingMemory = false;

// Delivery logic
async function processNotificationInline(userId, { type = 'system', title, message, data = {} }) {
    const supabase = require('./supabase');
    let row = null;

    if (supabase) {
        try {
            const { data: inserted, error } = await supabase
                .from('notifications')
                .insert({ user_id: userId, type, title, message, data, is_read: false })
                .select()
                .single();
            if (!error) row = inserted;
        } catch (e) {
            logger.warn('[notification] DB insert failed', { error: e.message });
        }
    }

    // Real-time delivery — map DB fields to what NotificationBell expects
    // The row above is the durable notification; the socket push is only for users online in this process.
    const { getIo, isSocketReady } = require('../services/tracking-service/socket');
    if (isSocketReady()) {
        const io = getIo();
        try {
            const payload = row
                ? { ...row, _id: row.id, isRead: row.is_read, createdAt: row.created_at }
                : { _id: String(Date.now()), type, title, message, data, isRead: false, createdAt: new Date().toISOString() };
            io.of('/notifications').to(`user_${userId}`).emit('notification:new', payload);
        } catch (e) {
            logger.warn('[notification] Socket emit failed', { error: e.message });
        }
    }
}

// Handled on ready event

function triggerMemoryWorker() {
    if (isProcessingMemory) return;
    isProcessingMemory = true;
    processNextMemoryMessage();
}

async function processNextMemoryMessage() {
    const task = memoryQueue.shift();
    if (!task) {
        isProcessingMemory = false;
        return;
    }
    try {
        await processNotificationInline(task.userId, task.payload);
    } catch (err) {
        logger.error('[notification-queue] Memory worker error:', { error: err.message });
    }
    setImmediate(processNextMemoryMessage);
}

/**
 * Pushes a notification request into the queue and triggers processing asynchronously.
 * @param {string} userId
 * @param {object} payload
 */
function pushToQueue(userId, payload) {
    if (notificationQueue && connection && connection.status === 'ready') {
        notificationQueue.add('deliver', { userId, payload }).catch((err) => {
            logger.error('[notification-queue] BullMQ add failed, falling back to memory queue:', { error: err.message });
            memoryQueue.push({ userId, payload });
            triggerMemoryWorker();
        });
    } else {
        memoryQueue.push({ userId, payload });
        triggerMemoryWorker();
    }
}

module.exports = {
    pushToQueue,
};
