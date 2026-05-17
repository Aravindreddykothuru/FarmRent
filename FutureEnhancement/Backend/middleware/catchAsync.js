'use strict';

/**
 * Async error catcher to eliminate try-catch blocks in controllers.
 * Wraps async route handlers and passes any thrown errors to next().
 */
const catchAsync = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

module.exports = catchAsync;
