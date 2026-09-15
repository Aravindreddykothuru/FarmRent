'use strict';

const router = require('express').Router();
const mongoSanitize = require('express-mongo-sanitize');
const { forgotPassword } = require('../controllers/forgotPasswordController');
const { resetPassword } = require('../controllers/resetPasswordController');
const { forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rateLimiter');

// SECURITY: Sanitize all inputs against NoSQL injection (e.g. mongo operators like $gt)
router.use(mongoSanitize());

/**
 * ─── POST /api/v1/auth/forgot-password ─────────────────────────────────────────
 * Request reset link via Email and SMS
 * Rate limit: max 3 requests per 15 minutes per IP
 */
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);

/**
 * ─── POST /api/v1/auth/reset-password/:token ───────────────────────────────────
 * Reset user password using the unique token
 * Rate limit: max 5 reset attempts per 15 minutes per IP
 */
router.post('/reset-password/:token', resetPasswordLimiter, resetPassword);

module.exports = router;
