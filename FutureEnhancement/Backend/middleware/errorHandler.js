'use strict';

/**
 * Global error handler middleware — must be last in the Express chain.
 */
const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';
    let extra = {};

    // ─── Mongoose Specific Errors ───────────────────────────────────────────────
    if (err.name === 'CastError') {
        statusCode = 400; // Bad Request
        message = `Resource not found with id of ${err.value}`;
    }

    if (err.code === 11000) {
        statusCode = 409; // Conflict
        const field = Object.keys(err.keyValue)[0];
        message = `An account with that ${field} already exists`;
    }

    if (err.name === 'ValidationError') {
        statusCode = 400; // Bad Request
        message = Object.values(err.errors).map(val => val.message).join(', ');
    }

    // ─── express-validator Errors (from validate middleware) ──────────────────
    if (err.validationErrors) {
        extra.validationErrors = err.validationErrors;
    }

    // Include other extra fields if present
    const { statusCode: _s, message: _m, stack, name, validationErrors, ...others } = err;
    extra = { ...extra, ...others };

    return res.status(statusCode).json({
        success: false,
        message,
        ...(Object.keys(extra).length > 0 && { details: extra }),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};

/**
 * 404 handler — place before errorHandler.
 */
const notFound = (req, res, next) => {
    const err = new Error(`Route not found: ${req.originalUrl}`);
    err.statusCode = 404;
    next(err);
};

module.exports = { errorHandler, notFound };
