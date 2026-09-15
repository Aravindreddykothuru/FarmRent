'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendPasswordResetConfirmationEmail } = require('../utils/emailService');
const logger = require('../utils/logger');

/**
 * Reset Password using Token
 * Endpoint: POST /api/v1/auth/reset-password/:token
 */
const resetPassword = async (req, res, next) => {
    try {
        const { token } = req.params;
        const { password, confirmPassword } = req.body || {};
        const ip = req.ip || req.connection.remoteAddress;

        if (!token) {
            return res.status(400).json({ success: false, error: 'Reset token is required.' });
        }

        if (!password || !confirmPassword) {
            return res.status(400).json({ success: false, error: 'Password and confirm password are required.' });
        }

        // 1. Hash incoming raw token to match against DB
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // Find user by token
        const user = await User.findOne({ resetPasswordToken: hashedToken });

        // Security logging metadata
        const hashedUserId = user ? crypto.createHash('sha256').update(String(user._id)).digest('hex') : 'anonymous';

        if (!user) {
            logger.warn('[resetPassword] Invalid token attempt', { ip, timestamp: new Date().toISOString() });
            return res.status(400).json({ success: false, error: 'Token is invalid or has expired.' });
        }

        // 2. Brute Force Protection: Check if reset is locked
        if (user.resetLockUntil && user.resetLockUntil > Date.now()) {
            const remainingLockMs = user.resetLockUntil.getTime() - Date.now();
            const minutes = Math.ceil(remainingLockMs / (60 * 1000));
            return res.status(429).json({
                success: false,
                error: `Too many failed attempts. This reset flow is temporarily locked. Try again in ${minutes} minutes.`,
            });
        }

        // Check if token has expired
        if (user.resetPasswordExpire && user.resetPasswordExpire < Date.now()) {
            logger.warn('[resetPassword] Expired token attempt', { userIdHash: hashedUserId, ip });
            return res.status(400).json({ success: false, error: 'Token is invalid or has expired.' });
        }

        // 3. Constant-time comparison to prevent timing attacks
        const dbTokenBuffer = Buffer.from(user.resetPasswordToken);
        const calculatedTokenBuffer = Buffer.from(hashedToken);
        if (dbTokenBuffer.length !== calculatedTokenBuffer.length || !crypto.timingSafeEqual(dbTokenBuffer, calculatedTokenBuffer)) {
            logger.warn('[resetPassword] Timing mismatch token attempt', { ip });
            return res.status(400).json({ success: false, error: 'Token is invalid or has expired.' });
        }

        // Helper to record a failure attempt
        const recordFailure = async () => {
            user.resetAttempts += 1;
            if (user.resetAttempts >= 5) {
                user.resetLockUntil = Date.now() + 15 * 60 * 1000; // Lock for 15 minutes
                logger.warn('[resetPassword] Reset attempts limit reached. Locking reset flow.', { userIdHash: hashedUserId, ip });
            }
            await user.save();
        };

        // 4. Validate matching passwords
        if (password !== confirmPassword) {
            await recordFailure();
            return res.status(400).json({ success: false, error: 'Passwords do not match.' });
        }

        // 5. Validate Password Strength
        // Rules: Min 8 chars, 1 uppercase, 1 number, 1 special char (!@#$%^&*)
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
        if (!passwordRegex.test(password)) {
            await recordFailure();
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character (!@#$%^&*).',
            });
        }

        // 6. Validate Password History: Cannot reuse last 3 passwords
        if (user.passwordHistory && user.passwordHistory.length > 0) {
            const isReused = await Promise.all(
                user.passwordHistory.map((hash) => bcrypt.compare(password, hash))
            );
            if (isReused.some((match) => match)) {
                await recordFailure();
                return res.status(400).json({
                    success: false,
                    error: 'Cannot reuse any of your last 3 passwords.',
                });
            }
        }

        // 7. Save new password (pre-save hook hashes it, updates history and passwordChangedAt)
        user.password = password;

        // IMMEDIATELY delete token + expiry + reset metrics from DB
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        user.resetAttempts = 0;
        user.resetLockUntil = undefined;

        await user.save();

        logger.info('[resetPassword] Password successfully reset', {
            userIdHash: hashedUserId,
            ip,
            timestamp: new Date().toISOString()
        });

        // 8. Send confirmation email (non-blocking)
        if (user.email) {
            sendPasswordResetConfirmationEmail(user.email, user.fullName).catch((err) => {
                logger.error('[resetPassword] Confirmation email failed', { error: err.message });
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Your password was successfully reset.',
        });
    } catch (err) {
        logger.error('[resetPassword] Error occurred during processing', { error: err.message });
        next(err);
    }
};

module.exports = {
    resetPassword,
};
