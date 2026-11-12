const Sentry = require('@sentry/node');
const logger = require('../lib/logger');
const { HttpError } = require('../lib/httpError');

function resolveStatus(err) {
    const status = err.statusCode || err.status;
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

// PostgREST's own "I cannot reach Postgres" answers: no connection, connection lost while loading the schema
// cache, and a pool that timed out handing one over.
const POSTGREST_DB_DOWN = /^PGRST00[0-3]$/;

/**
 * True when a query failed because the database could not be reached, rather than because of anything in the
 * request or the code.
 *
 * supabase-js does not throw when its request never arrives. It resolves with a plain object —
 * { message: 'TypeError: fetch failed', details, hint, code } — which every route then throws as it would a
 * constraint violation. Unrecognised, that reached people as "Unexpected server error" on every page for as
 * long as the database was away, which reads as a broken site rather than one that will be back.
 */
function isDatabaseUnreachable(err) {
    if (!err || err instanceof Error || typeof err !== 'object') return false;
    if (typeof err.code === 'string' && POSTGREST_DB_DOWN.test(err.code)) return true;
    return typeof err.message === 'string' && /: fetch failed$/.test(err.message) && 'details' in err && 'hint' in err;
}

const DB_UNAVAILABLE_RETRY_SECONDS = 30;

// Centralized error handler for consistent JSON responses.
// 4xx: expected rejections (validation, auth, conflicts) — logged at warn, message returned as-is.
// 5xx HttpError: a deliberate "dependency unavailable" answer (e.g. payments not configured) — its code and
// message are written for the client and are returned as-is.
// Database unreachable: 503 DB_UNAVAILABLE with a Retry-After — an outage, said as one.
// Any other 5xx: bugs or dependency failures — logged with stack; internals (DB error details, stack) only
// leave the server outside production.
function errorHandler(err, req, res, _next) {
    if (isDatabaseUnreachable(err)) {
        // One line per request, and no stack: during an outage every request fails the same way, and the
        // stack is supabase-js's, not ours.
        logger.error('database_unreachable', {
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl,
            status: 503,
            code: err.code || undefined,
            error: err.message,
        });
        if (res.headersSent) return;
        res.set('Retry-After', String(DB_UNAVAILABLE_RETRY_SECONDS));
        res.status(503).json({
            success: false,
            error: {
                code: 'DB_UNAVAILABLE',
                message: 'FarmRent is temporarily unavailable. Please try again in a few minutes.',
                details: {},
            },
        });
        return;
    }

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

module.exports = { errorHandler, isDatabaseUnreachable };
