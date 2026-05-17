'use strict';

/**
 * Request logger middleware — logs method, url, status, and response time.
 */
const requestLogger = (req, res, next) => {
    const start = Date.now();
    const { method, originalUrl, ip } = req;

    res.on('finish', () => {
        const ms = Date.now() - start;
        const status = res.statusCode;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        const msg = `${method} ${originalUrl} ${status} — ${ms}ms [${ip}]`;

        // Use winston logger if available, else fallback to console
        try {
            const logger = require('../utils/logger');
            logger[level](msg);
        } catch {
            console.log(msg);
        }
    });

    next();
};

module.exports = { requestLogger };
