const logger = require('../lib/logger');

// Centralized error handler for consistent JSON responses.
function errorHandler(err, req, res, _next) {
    logger.error('unhandled_error', { requestId: req.requestId, error: err.message, stack: err.stack });

    if (res.headersSent) {
        return;
    }

    const status = err.statusCode || 500;
    const message = status === 500
        ? 'Unexpected server error'
        : err.message || 'Request failed';

    res.status(status).json({
        status: 'error',
        message,
    });
}

module.exports = { errorHandler };

