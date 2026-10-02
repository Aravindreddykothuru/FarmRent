const { Worker } = require('bullmq');
const { connection } = require('../lib/queueManager');
const logger = require('../lib/logger');

let imageWorker = null;

function initImageWorker() {
    if (imageWorker) return;

    try {
        imageWorker = new Worker(
            'images',
            async (job) => {
                const { s3Key, mimeType, userId } = job.data;
                if (!s3Key) throw new Error('s3Key is required for image processing job');

                logger.info('[image-worker] Starting image optimization:', { s3Key, mimeType, userId });

                // Simulate image optimization processing
                await new Promise((resolve) => setTimeout(resolve, 2000));

                logger.info('[image-worker] Image optimized successfully:', { s3Key });
            },
            {
                connection,
                concurrency: 3,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
            },
        );

        imageWorker.on('completed', (job) => {
            logger.info(`[image-worker] Job ${job.id} completed successfully`);
        });

        imageWorker.on('failed', (job, err) => {
            const loggedErrors = global.loggedWorkerErrors || (global.loggedWorkerErrors = new Set());
            const errKey = `image:${err.message}`;
            if (!loggedErrors.has(errKey)) {
                logger.error(`[image-worker] Job ${job?.id} failed: ${err.message}`);
                loggedErrors.add(errKey);
            }
        });

        process.once('SIGTERM', () => {
            imageWorker.close().catch(() => {});
        });
        process.once('SIGINT', () => {
            imageWorker.close().catch(() => {});
        });
    } catch (err) {
        logger.warn(`[image-worker] Initialization skipped: ${err.message}`);
    }
}

module.exports = { initImageWorker };
