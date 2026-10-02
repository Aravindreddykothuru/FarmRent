const crypto = require('crypto');

// Error code used when a handler responds with an error status but no explicit code.
const DEFAULT_ERROR_CODES = Object.freeze({
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'RATE_LIMITED',
    503: 'SERVICE_UNAVAILABLE',
});

/**
 * Universal Response Envelope Middleware
 * Ensures every API response matches the standard shape required by mobile clients.
 */
function responseEnvelope() {
    return (req, res, next) => {
        // Exclude operational and file endpoints
        if (
            req.path === '/health' ||
            req.path === '/health/full' ||
            req.path.startsWith('/uploads') ||
            req.path.startsWith('/api/dev/emails')
        ) {
            return next();
        }

        // Ensure requestId exists
        if (!req.requestId) {
            req.requestId = crypto.randomUUID();
        }

        const originalJson = res.json;

        res.json = function (body) {
            const timestamp = new Date().toISOString();
            const requestId = req.requestId;

            // 1. If it's already a fully-formed envelope structure, pass it through
            if (body && typeof body === 'object' && 'success' in body && 'data' in body && 'error' in body && 'timestamp' in body) {
                return originalJson.call(this, body);
            }

            // 2. Detect error responses
            const isError = res.statusCode >= 400 || (body && (body.error || body.status === 'error' || body.success === false));

            if (isError) {
                let errorCode = DEFAULT_ERROR_CODES[res.statusCode] || 'REQUEST_FAILED';
                let errorMessage = 'Request failed';
                let errorDetails = {};

                if (body) {
                    if (typeof body === 'string') {
                        errorMessage = body;
                    } else if (body.error) {
                        if (typeof body.error === 'string') {
                            errorMessage = body.error;
                        } else if (typeof body.error === 'object') {
                            errorCode = body.error.code || errorCode;
                            errorMessage = body.error.message || errorMessage;
                            errorDetails = body.error.details || body.error;
                        }
                    } else if (body.message) {
                        errorMessage = body.message;
                    }

                    if (body.code) {
                        errorCode = body.code;
                    }
                    if (body.details) {
                        errorDetails = body.details;
                    }
                    // Field-level validation messages from middleware/validate.js
                    if (Array.isArray(body.errors)) {
                        errorDetails = { ...errorDetails, fields: body.errors };
                    }
                }

                return originalJson.call(this, {
                    success: false,
                    data: null,
                    error: {
                        code: errorCode,
                        message: errorMessage,
                        details: errorDetails,
                    },
                    timestamp,
                    requestId,
                });
            }

            // 3. Success responses
            let data = body;
            let meta = undefined;

            if (body && typeof body === 'object' && !Array.isArray(body)) {
                // Extract data block if already nested
                if ('data' in body) {
                    data = body.data;
                }

                // Extract meta pagination block if present
                if (body.meta) {
                    meta = body.meta;
                } else if (
                    body.page !== undefined ||
                    body.pageSize !== undefined ||
                    body.totalPages !== undefined ||
                    body.totalItems !== undefined ||
                    body.count !== undefined
                ) {
                    meta = {
                        page: Number(body.page || req.query.page || 1),
                        pageSize: Number(body.pageSize || body.size || req.query.size || 20),
                        totalItems: Number(body.totalItems || body.count || 0),
                        totalPages: Number(body.totalPages || 1),
                    };
                    if (meta.totalItems && meta.pageSize) {
                        meta.totalPages = Math.ceil(meta.totalItems / meta.pageSize);
                    }
                }
            }

            const envelope = {
                success: true,
                data: data !== undefined ? data : null,
                error: null,
                timestamp,
                requestId,
            };

            if (meta) {
                envelope.meta = meta;
            }

            return originalJson.call(this, envelope);
        };

        next();
    };
}

module.exports = { responseEnvelope };
