'use strict';

const crypto = require('crypto');
const validator = require('validator');
const User = require('../models/User');
const { sendPasswordResetEmail } = require('../utils/emailService');
const { sendPasswordResetSMS } = require('../utils/smsService');
const cache = require('../utils/cacheManager');
const logger = require('../utils/logger');

// Security: Alert admin if >10 reset requests in 5 minutes from same IP
const alertAdmin = (ip, count) => {
    logger.error(`[SECURITY ALERT] Suspicious Activity: IP ${ip} has requested password reset ${count} times in the last 5 minutes.`);
};

/**
 * Request Password Reset (Forgot Password)
 * Endpoint: POST /api/v1/auth/forgot-password
 */
const forgotPassword = async (req, res, next) => {
    try {
        const { emailOrPhone } = req.body || {};
        const ip = req.ip || req.connection.remoteAddress;

        if (!emailOrPhone) {
            return res.status(400).json({ success: false, error: 'Email or phone number is required.' });
        }

        // 1. SECURITY & MONITORING: Track requests from same IP in 5 minutes
        const ipResetKey = `reset_req_ip:${ip}`;
        let requestCount = 1;
        if (cache.isConnected) {
            try {
                requestCount = await cache.client.incr(ipResetKey);
                if (requestCount === 1) {
                    await cache.client.expire(ipResetKey, 300); // 5 minutes
                }
            } catch (err) {
                logger.error('[forgotPassword] Redis IP count failed, using fallback', { error: err.message });
            }
        } else {
            // Memory fallback for dev/single-instance without Redis
            if (!global.ipResetStore) global.ipResetStore = new Map();
            const now = Date.now();
            const entry = global.ipResetStore.get(ipResetKey) || { count: 0, expiresAt: now + 300 * 1000 };
            if (now > entry.expiresAt) {
                entry.count = 1;
                entry.expiresAt = now + 300 * 1000;
            } else {
                entry.count += 1;
            }
            global.ipResetStore.set(ipResetKey, entry);
            requestCount = entry.count;
        }

        if (requestCount > 10) {
            alertAdmin(ip, requestCount);
        }

        // 2. Identify target search: email format vs phone number
        let isEmail = validator.isEmail(emailOrPhone);
        let query = {};
        if (isEmail) {
            query.email = emailOrPhone.trim().toLowerCase();
        } else {
            // Strip any non-digit chars to match phone format
            const normalizedPhone = emailOrPhone.replace(/\D/g, '');
            if (normalizedPhone.length < 10) {
                // Return generic response even for malformed/unrecognized input to prevent enumeration
                return res.status(200).json({
                    success: true,
                    message: 'If this account exists, a reset link has been sent.',
                });
            }
            // Match phone directly or with possible +91/91 prefix in query
            query.phone = normalizedPhone;
        }

        // 3. Find user in Database
        const user = await User.findOne(query);

        // Hashing of User ID for logs (prevent exposing PII)
        const hashedUserId = user ? crypto.createHash('sha256').update(String(user._id)).digest('hex') : 'anonymous';

        // 4. SECURITY: Generic response returned whether user exists or not
        const genericResponse = () => {
            logger.info('[forgotPassword] Reset requested', {
                userIdHash: hashedUserId,
                ip,
                success: !!user,
                timestamp: new Date().toISOString()
            });

            return res.status(200).json({
                success: true,
                message: 'If this account exists, a reset link has been sent.',
            });
        };

        if (!user) {
            return genericResponse();
        }

        // 5. Generate secure random 32-byte reset token
        const rawToken = crypto.randomBytes(32).toString('hex');

        // Hash token with SHA-256 before DB storage (never store raw)
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

        // Set token expiration (30 mins from now) and reset attempts
        user.resetPasswordToken = hashedToken;
        user.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // 30 minutes
        user.resetAttempts = 0;
        user.resetLockUntil = undefined;

        await user.save();

        // 6. Send raw token to user via configured channels
        if (user.email) {
            await sendPasswordResetEmail(user.email, user.fullName, rawToken);
        }
        if (user.phone) {
            await sendPasswordResetSMS(user.phone, rawToken);
        }

        return genericResponse();
    } catch (err) {
        logger.error('[forgotPassword] Error occurred during processing', { error: err.message });
        next(err);
    }
};

module.exports = {
    forgotPassword,
};
