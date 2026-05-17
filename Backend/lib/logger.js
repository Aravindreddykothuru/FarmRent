const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

const jsonFormat = format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
);

const devFormat = format.combine(
    format.colorize(),
    format.timestamp({ format: 'HH:mm:ss' }),
    format.printf(({ timestamp, level, message, ...meta }) => {
        const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        return `${timestamp} ${level}: ${message}${extras}`;
    })
);

const loggerTransports = [
    new transports.Console({ format: isProd ? jsonFormat : devFormat }),
];

if (isProd) {
    const logsDir = path.join(__dirname, '../logs');
    loggerTransports.push(
        new DailyRotateFile({
            filename:   path.join(logsDir, 'app-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles:   '14d',
            maxSize:    '50m',
            format:     jsonFormat,
        }),
        new DailyRotateFile({
            filename:   path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level:      'error',
            maxFiles:   '30d',
            maxSize:    '50m',
            format:     jsonFormat,
        })
    );
}

const logger = createLogger({
    level: isProd ? 'info' : 'debug',
    transports: loggerTransports,
});

module.exports = logger;
