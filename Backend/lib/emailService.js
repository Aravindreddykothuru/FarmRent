/**
 * emailService.js — Multi-provider email delivery for FarmRent
 *
 * Priority order:
 *   1. Resend API  (set RESEND_API_KEY)         — recommended, free 3 000/month
 *   2. SMTP/Gmail  (set SMTP_HOST + SMTP_USER + SMTP_PASS)
 *   3. Dev console — prints the email + link to stdout so you can test locally
 *
 * ── Quick start with Resend (5 min, no credit card) ──────────────────────────
 *   1. Sign up at https://resend.com/signup
 *   2. Dashboard → API Keys → Create API Key → copy it
 *   3. Add to .env:  RESEND_API_KEY=re_xxxxxxxxxxxx
 *                    EMAIL_FROM=FarmRent <onboarding@resend.dev>
 *      (Use onboarding@resend.dev for testing. For production, verify your domain.)
 *
 * ── Gmail SMTP (alternative) ─────────────────────────────────────────────────
 *   1. myaccount.google.com → Security → 2-Step Verification (enable)
 *   2. myaccount.google.com → Security → App passwords → Other → "FarmRent"
 *   3. Add to .env:
 *        SMTP_HOST=smtp.gmail.com
 *        SMTP_PORT=587
 *        SMTP_USER=you@gmail.com
 *        SMTP_PASS=xxxx xxxx xxxx xxxx   ← 16-char app password (no spaces)
 *        EMAIL_FROM=FarmRent <you@gmail.com>
 */

const logger = require('./logger');
const devStore = require('./devEmailStore');

let nodemailer;
try { nodemailer = require('nodemailer'); } catch { /* optional */ }

// ── Provider: Resend ─────────────────────────────────────────────────────────

async function sendViaResend({ to, subject, html }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return false;

    const from = process.env.EMAIL_FROM || 'FarmRent <onboarding@resend.dev>';

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({ from, to, subject, html }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            logger.warn('[email/resend] Send failed', { status: res.status, err });
            return false;
        }
        logger.info('[email/resend] Sent', { to, subject });
        return true;
    } catch (e) {
        logger.warn('[email/resend] Network error', { error: e.message });
        return false;
    }
}

// ── Provider: Brevo SMTP (free 300/day, no domain verification needed) ────────

async function sendViaBrevo({ to, subject, html }) {
    if (!nodemailer) return false;
    const { BREVO_SMTP_USER, BREVO_SMTP_PASS, BREVO_SENDER_EMAIL, EMAIL_FROM } = process.env;
    if (!BREVO_SMTP_USER || !BREVO_SMTP_PASS) return false;

    // BREVO_SMTP_USER is just the login key, not a real email address.
    // The sender must be a verified email/domain in your Brevo account.
    const senderEmail = BREVO_SENDER_EMAIL || EMAIL_FROM;
    if (!senderEmail || senderEmail.includes('resend.dev') || senderEmail.includes('smtp-brevo.com')) {
        logger.warn('[email/brevo] No valid sender email configured. Set BREVO_SENDER_EMAIL in .env');
        return false;
    }

    try {
        const transporter = nodemailer.createTransport({
            host:   'smtp-relay.brevo.com',
            port:   587,
            secure: false,
            auth:   { user: BREVO_SMTP_USER, pass: BREVO_SMTP_PASS },
        });
        await transporter.sendMail({ from: senderEmail, to, subject, html });
        logger.info('[email/brevo] Sent', { to, subject });
        return true;
    } catch (e) {
        logger.warn('[email/brevo] Send failed', { error: e.message });
        return false;
    }
}

// ── Provider: Nodemailer / SMTP ───────────────────────────────────────────────

function buildSmtpTransport() {
    if (!nodemailer) return null;
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
    return nodemailer.createTransport({
        host:   SMTP_HOST,
        port:   Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465,
        auth:   { user: SMTP_USER, pass: SMTP_PASS },
    });
}

async function sendViaSmtp({ to, subject, html }) {
    const transporter = buildSmtpTransport();
    if (!transporter) return false;

    const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
    try {
        await transporter.sendMail({ from, to, subject, html });
        logger.info('[email/smtp] Sent', { to, subject });
        return true;
    } catch (e) {
        logger.warn('[email/smtp] Send failed', { error: e.message });
        return false;
    }
}

// ── Provider: Ethereal (auto-generated test account, clickable preview URL) ───

let _etherealAccount = null;

async function getEtherealAccount() {
    if (_etherealAccount) return _etherealAccount;
    if (!nodemailer) return null;
    try {
        _etherealAccount = await nodemailer.createTestAccount();
        return _etherealAccount;
    } catch {
        return null;
    }
}

async function sendViaEthereal({ to, subject, html }) {
    if (!nodemailer) return false;
    const account = await getEtherealAccount();
    if (!account) return false;

    try {
        const transporter = nodemailer.createTransport({
            host:   'smtp.ethereal.email',
            port:   587,
            secure: false,
            auth:   { user: account.user, pass: account.pass },
        });

        const info = await transporter.sendMail({
            from: 'FarmRent <farmrent@ethereal.email>',
            to, subject, html,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info);
        const divider = '═'.repeat(65);
        logger.warn(
            `\n${divider}\n` +
            `📧  DEV EMAIL PREVIEW — open this URL in your browser:\n\n` +
            `  ➜  ${previewUrl}\n\n` +
            `  To:      ${to}\n` +
            `  Subject: ${subject}\n` +
            `${divider}`
        );
        return true;
    } catch (e) {
        logger.warn('[email/ethereal] Failed', { error: e.message });
        return false;
    }
}

// ── Unified send ──────────────────────────────────────────────────────────────

async function send({ to, subject, html }) {
    if (!to) return;

    // Always capture in dev store so /dev/emails works regardless of provider
    devStore.store({ to, subject, html });

    // 1. Gmail / custom SMTP — most reliable, works for any recipient
    if (await sendViaSmtp({ to, subject, html })) return;
    // 2. Resend — works when domain is verified or sending to account owner email
    if (await sendViaResend({ to, subject, html })) return;
    // 3. Brevo SMTP — free 300/day
    if (await sendViaBrevo({ to, subject, html })) return;
    // 4. Dev preview — Ethereal catches the email; preview URL printed to console
    await sendViaEthereal({ to, subject, html });
}

// ── Email templates ───────────────────────────────────────────────────────────

const base = (content) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#166534;padding:24px 32px;">
    <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px;">🌾 FarmRent</span>
  </div>
  <div style="padding:32px;">${content}</div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
    <p style="color:#9ca3af;font-size:12px;margin:0;">
      You received this email because you have a FarmRent account.
      If you did not request this, you can safely ignore it.
    </p>
  </div>
</div>`;

const btn = (href, text, color = '#166534') =>
    `<div style="text-align:center;margin:32px 0;">
       <a href="${href}" style="background:${color};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
         ${text}
       </a>
     </div>`;

async function sendVerificationEmail(userEmail, { userName, link }) {
    await send({
        to:      userEmail,
        subject: '✅ Verify your FarmRent email address',
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Verify Your Email</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Welcome to FarmRent! Click the button below to verify your email address and activate your account.</p>
          ${btn(link, 'Verify My Email')}
          <p style="color:#6b7280;font-size:13px;">This link expires in <strong>24 hours</strong>.</p>
          <p style="color:#6b7280;font-size:13px;">Or copy this link into your browser:<br>
            <a href="${link}" style="color:#166534;word-break:break-all;">${link}</a>
          </p>`),
    });
}

async function sendPasswordResetEmail(userEmail, { userName, link }) {
    await send({
        to:      userEmail,
        subject: '🔐 Reset your FarmRent password',
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Reset Your Password</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">
            We received a request to reset your FarmRent password.
            Click the button below to create a new password.
          </p>
          ${btn(link, 'Reset My Password', '#dc2626')}
          <p style="color:#6b7280;font-size:13px;">
            This link expires in <strong>1 hour</strong>.
            If you did not request a password reset, no action is needed — your password will not change.
          </p>
          <p style="color:#6b7280;font-size:13px;">Or copy this link into your browser:<br>
            <a href="${link}" style="color:#dc2626;word-break:break-all;">${link}</a>
          </p>`),
    });
}

async function sendBookingConfirmation(userEmail, { userName, equipmentName, startDate, endDate, totalAmount, bookingId }) {
    await send({
        to:      userEmail,
        subject: `✅ Booking Confirmed — ${equipmentName}`,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Booking Confirmed 🎉</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Your booking for <strong>${equipmentName}</strong> has been confirmed.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Rental Period</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">${startDate} → ${endDate}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Total Amount</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">₹${totalAmount}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Booking ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${bookingId}</td></tr>
          </table>
          <p style="color:#6b7280;font-size:13px;">Thank you for using FarmRent!</p>`),
    });
}

async function sendPaymentReceipt(userEmail, { userName, equipmentName, amountPaid, paymentId, bookingId }) {
    await send({
        to:      userEmail,
        subject: `💰 Payment Receipt — ₹${amountPaid}`,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Payment Successful</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Your payment for <strong>${equipmentName}</strong> has been received.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Amount Paid</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">₹${amountPaid}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Payment ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${paymentId}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Booking ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${bookingId}</td></tr>
          </table>
          <p style="color:#6b7280;font-size:13px;">Keep this email as your receipt.</p>`),
    });
}

async function sendCancellationEmail(userEmail, { userName, equipmentName, bookingId, refundAmount }) {
    const refundHtml = refundAmount
        ? `<p style="color:#374151;">A refund of <strong>₹${refundAmount}</strong> has been initiated and will reflect in 5–7 business days.</p>`
        : '';
    await send({
        to:      userEmail,
        subject: `🚫 Booking Cancelled — ${equipmentName}`,
        html: base(`
          <h2 style="color:#dc2626;margin-top:0;">Booking Cancelled</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Your booking for <strong>${equipmentName}</strong> (ID: <code>${bookingId}</code>) has been cancelled.</p>
          ${refundHtml}
          <p style="color:#6b7280;font-size:13px;">If you have questions, contact FarmRent support.</p>`),
    });
}

async function sendNewBookingRequestToOwner(ownerEmail, { ownerName, farmerName, equipmentName, startDate, endDate, bookingId }) {
    await send({
        to:      ownerEmail,
        subject: `📋 New Booking Request — ${equipmentName}`,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">New Booking Request</h2>
          <p style="color:#374151;">Hi <strong>${ownerName}</strong>,</p>
          <p style="color:#374151;"><strong>${farmerName}</strong> wants to rent your <strong>${equipmentName}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Rental Period</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">${startDate} → ${endDate}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Booking ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${bookingId}</td></tr>
          </table>
          <p style="color:#374151;">Log in to your FarmRent dashboard to accept or reject this request.</p>`),
    });
}

module.exports = {
    send,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendBookingConfirmation,
    sendPaymentReceipt,
    sendCancellationEmail,
    sendNewBookingRequestToOwner,
};
