const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

const isProd = process.env.NODE_ENV === 'production';
const logsDir = path.join(__dirname, '../logs');

if (isProd && !fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Thread-local context for request correlation
const asyncLocalStorage = new AsyncLocalStorage();

const redactPaths = [
    'req.headers.authorization',
    'req.headers.cookie',
    'headers.authorization',
    'headers.cookie',
    'password',
    'password_hash',
    'token',
    'refreshToken',
    'rfsh',
    'otp',
    'cvv',
    'secret',
    'card',
    '*.password',
    '*.token',
    '*.otp',
];

let loggerInstance;

if (isProd) {
    loggerInstance = pino(
        {
            level: 'info',
            redact: {
                paths: redactPaths,
                censor: '[REDACTED]',
            },
        },
        pino.destination(path.join(logsDir, 'app.log')),
    );
} else {
    loggerInstance = pino({
        level: 'debug',
        redact: {
            paths: redactPaths,
            censor: '[REDACTED]',
        },
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
            },
        },
    });
}

// Wrapper to inject requestId from AsyncLocalStorage context automatically
const getRequestId = () => asyncLocalStorage.getStore();

const logger = {
    info: (msg, meta = {}) => {
        const reqId = getRequestId();
        const finalMeta = reqId ? { reqId, ...meta } : meta;
        loggerInstance.info(finalMeta, msg);
    },
    error: (msg, meta = {}) => {
        const reqId = getRequestId();
        const finalMeta = reqId ? { reqId, ...meta } : meta;
        loggerInstance.error(finalMeta, msg);
    },
    warn: (msg, meta = {}) => {
        const reqId = getRequestId();
        const finalMeta = reqId ? { reqId, ...meta } : meta;
        loggerInstance.warn(finalMeta, msg);
    },
    debug: (msg, meta = {}) => {
        const reqId = getRequestId();
        const finalMeta = reqId ? { reqId, ...meta } : meta;
        loggerInstance.debug(finalMeta, msg);
    },
    asyncLocalStorage, // Export context for middleware
    pinoInstance: loggerInstance,
};

module.exports = logger;
