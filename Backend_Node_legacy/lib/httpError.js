/**
 * Error with an HTTP status and a stable machine-readable code.
 * Thrown from route handlers and rendered by middleware/errorHandler.js.
 */
class HttpError extends Error {
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.code = code;
        if (details) this.details = details;
    }
}

module.exports = { HttpError };
