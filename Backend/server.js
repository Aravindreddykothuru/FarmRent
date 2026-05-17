const http = require('http');
require('dotenv').config();

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
