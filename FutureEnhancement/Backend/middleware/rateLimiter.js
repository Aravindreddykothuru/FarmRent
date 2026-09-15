'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate Limiter for Forgot Password request:
 * Max 3 requests per IP per 15 minutes.
 */
const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // Limit each IP to 3 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
        success: false,
        error: 'Too many forgot password requests. Please try again after 15 minutes.',
    },
});

/**
 * Rate Limiter for Reset Password requests (attempts):
 * Max 5 attempts per IP/token per 15 minutes.
 */
const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 attempts per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many password reset attempts. This IP has been temporarily blocked for 15 minutes.',
    },
});

module.exports = {
    forgotPasswordLimiter,
    resetPasswordLimiter,
};
