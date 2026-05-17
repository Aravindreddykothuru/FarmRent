'use strict';

const cron = require('node-cron');

let logger;
try {
    logger = require('./logger');
} catch {
    logger = console;
}

/**
 * Initialize background cron jobs
 * Add scheduled tasks here as the application grows.
 */
const initCronJobs = () => {
    // Heartbeat every hour — placeholder for real jobs
    cron.schedule('0 * * * *', () => {
        logger.info('⏰ Cron: hourly heartbeat');
    });

    logger.info('✅ Cron jobs initialized');
};

module.exports = initCronJobs;
