const http = require('http');
const path = require('path');
// FARMRENT_ENV_FILE selects an alternate env file (e.g. .env.localstack) without editing .env.
require('dotenv').config({
    path: process.env.FARMRENT_ENV_FILE ? path.resolve(process.env.FARMRENT_ENV_FILE) : path.join(__dirname, '.env'),
});

const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: 1.0,
    });
}

const { connectRedis } = require('./services/tracking-service/redisClient');
const { initializeSocket } = require('./services/tracking-service/socket');
const { buildBackendApplication } = require('./app');
const logger = require('./lib/logger');

// Connect to Redis for tracking service
connectRedis();

const app = buildBackendApplication();
const server = http.createServer(app);

initializeSocket(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    logger.info(`API Gateway running on port ${PORT}`);
    logger.info('WebSocket server listening for tracking updates');
});
