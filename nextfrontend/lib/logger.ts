import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

const redactPaths = [
    'password',
    'token',
    'refreshToken',
    'rfsh',
    'otp',
    'cvv',
    'secret',
    'card'
];

export const logger = isProd
    ? pino({
        level: 'info',
        browser: {
            asObject: true
        },
        redact: {
            paths: redactPaths,
            censor: '[REDACTED]'
        }
    })
    : pino({
        level: 'debug',
        browser: {
            asObject: true
        },
        redact: {
            paths: redactPaths,
            censor: '[REDACTED]'
        },
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname'
            }
        }
    });

export default logger;
