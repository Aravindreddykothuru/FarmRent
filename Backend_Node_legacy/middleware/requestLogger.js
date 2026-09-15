const crypto = require('crypto');
const logger = require('../lib/logger');

function requestLogger() {
    return (req, res, next) => {
        req.requestId = crypto.randomUUID();
        const start = Date.now();

        res.on('finish', () => {
            logger.info('request', {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs: Date.now() - start,
                userId: req.user?.id ?? null,
                ip: req.ip,
            });
        });

        // Run next() inside AsyncLocalStorage context so all logs generated in this request get reqId
        logger.asyncLocalStorage.run(req.requestId, () => {
            next();
        });
    };
}

module.exports = { requestLogger };
