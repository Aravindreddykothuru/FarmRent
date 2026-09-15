const { Worker } = require('bullmq');
const { connection } = require('../lib/queueManager');
const supabase = require('../lib/supabase');
const { send } = require('../lib/emailService');
const { pushToQueue } = require('../lib/notificationQueue');
const logger = require('../lib/logger');

let cleanupWorker = null;
let reminderWorker = null;

function initCronWorkers() {
    if (cleanupWorker || reminderWorker) return;

    try {
        // 1. Cleanup worker
        cleanupWorker = new Worker(
            'cleanups',
            async (_job) => {
                logger.info('[cleanup-worker] Running system cleanup job');
                if (!supabase) return;

                // Clean up notifications older than 30 days
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                const { error, count } = await supabase
                    .from('notifications')
                    .delete({ count: 'exact' })
                    .lt('created_at', thirtyDaysAgo.toISOString());

                if (error) {
                    logger.error('[cleanup-worker] Failed to clean old notifications:', { error: error.message });
                } else {
                    logger.info('[cleanup-worker] Old notifications cleaned up successfully:', { count });
                }
            },
            {
                connection,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
            },
        );

        // 2. Scheduled reminders worker
        reminderWorker = new Worker(
            'reminders',
            async (_job) => {
                logger.info('[reminder-worker] Processing scheduled rental reminders');
                if (!supabase) return;

                // Find bookings starting tomorrow
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStr = tomorrow.toISOString().split('T')[0];

                const { data: bookings, error } = await supabase
                    .from('equipment_rentals')
                    .select('*, renter:users(*), equipment(*)')
                    .eq('start_date', tomorrowStr)
                    .eq('status', 'approved');

                if (error) {
                    logger.error("[reminder-worker] Failed to fetch tomorrow's bookings:", { error: error.message });
                    return;
                }

                logger.info(`[reminder-worker] Found ${bookings?.length || 0} rentals starting tomorrow`);

                for (const booking of bookings || []) {
                    const renterEmail = booking.renter?.email;
                    const renterName = booking.renter?.full_name || 'Farmer';
                    const equipName = booking.equipment?.name || 'Equipment';

                    if (renterEmail) {
                        // Send email reminder
                        await send({
                            to: renterEmail,
                            subject: `⏰ Reminder: Your rental for ${equipName} starts tomorrow!`,
                            html: `<p>Hi ${renterName},</p><p>This is a reminder that your rental booking for <strong>${equipName}</strong> starts tomorrow (${tomorrowStr}). Please coordinate with the owner.</p>`,
                        }).catch((e) => logger.warn('[reminder-worker] Email failed:', { error: e.message }));
                    }

                    // In-app notification
                    pushToQueue(booking.renter_id, {
                        title: 'Rental Starts Tomorrow ⏰',
                        message: `Your rental booking for ${equipName} starts tomorrow.`,
                        type: 'system',
                    });
                }
            },
            {
                connection,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
            },
        );

        cleanupWorker.on('failed', (job, err) => {
            const loggedErrors = global.loggedWorkerErrors || (global.loggedWorkerErrors = new Set());
            const errKey = `cleanup:${err.message}`;
            if (!loggedErrors.has(errKey)) {
                logger.error(`[cleanup-worker] Failed: ${err.message}`);
                loggedErrors.add(errKey);
            }
        });

        reminderWorker.on('failed', (job, err) => {
            const loggedErrors = global.loggedWorkerErrors || (global.loggedWorkerErrors = new Set());
            const errKey = `reminder:${err.message}`;
            if (!loggedErrors.has(errKey)) {
                logger.error(`[reminder-worker] Failed: ${err.message}`);
                loggedErrors.add(errKey);
            }
        });

        process.once('SIGTERM', () => {
            cleanupWorker.close().catch(() => {});
            reminderWorker.close().catch(() => {});
        });
        process.once('SIGINT', () => {
            cleanupWorker.close().catch(() => {});
            reminderWorker.close().catch(() => {});
        });
    } catch (err) {
        logger.warn(`[cron-workers] Initialization skipped: ${err.message}`);
    }
}

module.exports = { initCronWorkers };
