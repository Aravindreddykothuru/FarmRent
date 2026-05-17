'use strict';

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length) {
        // filter out symbols
        const cleanMeta = {};
        for (const key in meta) {
            if (typeof key === 'string') cleanMeta[key] = meta[key];
        }
        if (Object.keys(cleanMeta).length) {
            metaStr = ` | ${JSON.stringify(cleanMeta)}`;
        }
    }
    return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
});
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
    ),
    transports: [
        new transports.Console({
            format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
        }),
        new transports.File({ filename: 'logs/error.log', level: 'error' }),
        new transports.File({ filename: 'logs/combined.log' }),
    ],
});

// Add http level support
logger.http = (msg) => logger.log('http', msg);

module.exports = logger;
