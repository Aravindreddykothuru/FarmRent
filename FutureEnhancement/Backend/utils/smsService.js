'use strict';

const logger = require('./logger');

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    try {
        const twilio = require('twilio');
        twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    } catch (err) {
        logger.warn('[sms] Failed to initialize Twilio client', { error: err.message });
    }
}

/**
 * Send password reset SMS
 */
const sendPasswordResetSMS = async (phone, token) => {
    const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;
    const message = `Farmer Rental: Reset your password: ${resetUrl} — Valid 30 mins. Ignore if not you.`;

    if (twilioClient && TWILIO_PHONE_NUMBER) {
        try {
            await twilioClient.messages.create({
                body: message,
                from: TWILIO_PHONE_NUMBER,
                to: phone,
            });
            logger.info('[sms] Password reset SMS sent', { to: phone });
            return true;
        } catch (err) {
            logger.error('[sms] Failed to send password reset SMS', { error: err.message, to: phone });
            return false;
        }
    } else {
        // Dev console fallback
        logger.warn('\n' + '='.repeat(60) + '\n' +
            `📱  [DEV FALLBACK] PASSWORD RESET SMS SENT TO: ${phone}\n` +
            `💬  Message: ${message}\n` +
            '='.repeat(60));
        return true;
    }
};

module.exports = {
    sendPasswordResetSMS,
};
