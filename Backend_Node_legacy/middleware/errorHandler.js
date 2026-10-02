const Sentry = require('@sentry/node');
const logger = require('../lib/logger');
const { HttpError } = require('../lib/httpError');

function resolveStatus(err) {
    const status = err.statusCode || err.status;
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

// Centralized error handler for consistent JSON responses.
// 4xx: expected rejections (validation, auth, conflicts) — logged at warn, message returned as-is.
// 5xx HttpError: a deliberate "dependency unavailable" answer (e.g. payments not configured) — its code and
// message are written for the client and are returned as-is.
// Any other 5xx: bugs or dependency failures — logged with stack; internals (DB error details, stack) only
// leave the server outside production.
function errorHandler(err, req, res, _next) {
    const status = resolveStatus(err);
    const isProd = process.env.NODE_ENV === 'production';
    const context = { requestId: req.requestId, method: req.method, path: req.originalUrl, status };
    const unexpected = status >= 500 && !(err instanceof HttpError);

    if (unexpected) {
        logger.error('unhandled_error', {
            ...context,
            error: err.message,
            code: err.code,
            details: err.details,
            hint: err.hint,
            stack: err.stack,
        });
        if (process.env.SENTRY_DSN) Sentry.captureException(err);
    } else if (status >= 500) {
        logger.error('service_unavailable', { ...context, code: err.code, error: err.message });
    } else {
        logger.warn('request_rejected', { ...context, code: err.code, error: err.message });
    }

    if (res.headersSent) {
        return;
    }

    const error = unexpected
        ? {
              code: 'INTERNAL_SERVER_ERROR',
              message: isProd ? 'Unexpected server error' : `[DEV] ${err.message}`,
              details: isProd ? {} : { code: err.code, details: err.details, hint: err.hint, stack: err.stack },
          }
        : {
              code: err.code || (err.type === 'entity.parse.failed' ? 'INVALID_JSON' : 'BAD_REQUEST'),
              message: err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message || 'Request failed',
              details: err.details || {},
          };

    res.status(status).json({ success: false, error });
}

module.exports = { errorHandler };
