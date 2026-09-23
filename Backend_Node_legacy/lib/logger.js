const pino = require('pino');
const { AsyncLocalStorage } = require('async_hooks');

const isProd = process.env.NODE_ENV === 'production';

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
    // Standard output, not a file. A log file inside a container is collected by nobody and thrown away with
    // the container, which leaves a production incident with no record of itself; the platform running the
    // process is what gathers, keeps and searches logs, and it reads them from stdout.
    //
    // The writes are synchronous. Buffered writes are faster, but process.exit discards whatever has not been
    // flushed — so the one line that explains why a process is about to die is exactly the line that gets lost.
    loggerInstance = pino(
        {
            level: 'info',
            redact: {
                paths: redactPaths,
                censor: '[REDACTED]',
            },
        },
        pino.destination({ dest: 1, sync: true }),
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
