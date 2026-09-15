'use strict';

const nodemailer = require('nodemailer');
const logger = require('./logger');

const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Build Nodemailer transport
let transporter = null;
if (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: parseInt(EMAIL_PORT, 10) || 587,
        secure: parseInt(EMAIL_PORT, 10) === 465,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    });
}

/**
 * Clean, branded HTML email template wrapper.
 */
const getHtmlTemplate = (title, bodyContent) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); overflow: hidden; }
    .header { background: linear-gradient(135deg, #15803d, #166534); padding: 32px 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .content { padding: 40px 32px; color: #374151; line-height: 1.6; }
    .button-container { text-align: center; margin: 32px 0; }
    .button { background-color: #16a34a; color: #ffffff !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(22, 163, 74, 0.2); }
    .footer { background-color: #f9fafb; padding: 24px 32px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; text-align: center; }
    .footer a { color: #16a34a; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🌾 Farmer Rental</h1>
    </div>
    <div class="content">
      ${bodyContent}
    </div>
    <div class="footer">
      <p>You received this email because you have a Farmer Rental account.</p>
      <p>If you did not request this, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>
`;

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (email, userName, token) => {
    const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;
    const subject = 'Farmer Rental - Password Reset Request';
    const bodyContent = `
        <h2 style="margin-top: 0; color: #111827;">Password Reset Request</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <div class="button-container">
            <a href="${resetUrl}" class="button" target="_blank">Reset Password</a>
        </div>
        <p style="color: #dc2626; font-weight: 600;">Warning: This reset link will expire in 30 minutes.</p>
        <p>If you did not request a password reset, no further action is required and your password will remain unchanged.</p>
        <p style="font-size: 13px; color: #6b7280; margin-top: 24px;">Or copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #16a34a; word-break: break-all;">${resetUrl}</a></p>
    `;

    const html = getHtmlTemplate(subject, bodyContent);

    if (transporter) {
        try {
            await transporter.sendMail({
                from: EMAIL_FROM ? `"Farmer Rental" <${EMAIL_FROM}>` : `"Farmer Rental" <${EMAIL_USER}>`,
                to: email,
                subject,
                html,
            });
            logger.info('[email] Password reset email sent', { to: email });
            return true;
        } catch (err) {
            logger.error('[email] Failed to send password reset email', { error: err.message });
            return false;
        }
    } else {
        // Dev console fallback
        logger.warn('\n' + '='.repeat(60) + '\n' +
            `📧  [DEV FALLBACK] PASSWORD RESET EMAIL SENT TO: ${email}\n` +
            `👉  Reset Link: ${resetUrl}\n` +
            `⏰  Expires: 30 minutes\n` +
            '='.repeat(60));
        return true;
    }
};

/**
 * Send password reset success confirmation email
 */
const sendPasswordResetConfirmationEmail = async (email, userName) => {
    const subject = 'Farmer Rental - Password Successfully Reset';
    const bodyContent = `
        <h2 style="margin-top: 0; color: #111827;">Password Successfully Reset</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>This is a confirmation that the password for your Farmer Rental account was successfully reset.</p>
        <p>If you did not make this change, please contact our support team immediately.</p>
    `;

    const html = getHtmlTemplate(subject, bodyContent);

    if (transporter) {
        try {
            await transporter.sendMail({
                from: EMAIL_FROM ? `"Farmer Rental" <${EMAIL_FROM}>` : `"Farmer Rental" <${EMAIL_USER}>`,
                to: email,
                subject,
                html,
            });
            logger.info('[email] Password reset confirmation sent', { to: email });
            return true;
        } catch (err) {
            logger.error('[email] Failed to send password reset confirmation', { error: err.message });
            return false;
        }
    } else {
        logger.warn('\n' + '='.repeat(60) + '\n' +
            `📧  [DEV FALLBACK] PASSWORD RESET CONFIRMATION TO: ${email}\n` +
            'Your password was successfully reset.\n' +
            '='.repeat(60));
        return true;
    }
};

module.exports = {
    sendPasswordResetEmail,
    sendPasswordResetConfirmationEmail,
};
