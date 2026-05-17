/**
 * otpService.js — OTP delivery for Indian phone numbers
 *
 * Provider priority:
 *   1. Email                 (always available — uses existing emailService)
 *   2. WhatsApp via Twilio   (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM)
 *   3. WhatsApp via Meta API (set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)
 *   4. MSG91 SMS             (set MSG91_AUTH_KEY — needs DLT for production)
 *   5. Twilio SMS            (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM)
 *   6. Console               (development only — OTP shown in API response)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const emailService = require('./emailService');

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_LENGTH    = 6;
const MAX_ATTEMPTS  = 5;

function generateOTP() {
    return String(crypto.randomInt(100000, 999999));
}

// ── Email provider ────────────────────────────────────────────────────────────

async function sendViaEmail(email, otp) {
    if (!email) return false;
    try {
        await emailService.send({
            to:      email,
            subject: '🌾 FarmRent — Your OTP Code',
            html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
  <div style="background:#166534;padding:24px 32px;">
    <span style="color:#fff;font-size:22px;font-weight:900;">🌾 FarmRent</span>
  </div>
  <div style="padding:32px;">
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Your verification code</h2>
    <p style="color:#6b7280;margin:0 0 28px;">Use this OTP to verify your phone number. It expires in <strong>10 minutes</strong>.</p>
    <div style="background:#f0fdf4;border:2px dashed #16a34a;border-radius:10px;padding:24px;text-align:center;margin-bottom:28px;">
      <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#166534;">${otp}</span>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:0;">Do not share this code with anyone. FarmRent will never ask for your OTP.</p>
  </div>
</div>`,
        });
        return true;
    } catch (e) {
        console.log('[DEBUG] sendViaEmail: caught error:', e.message);
        logger.warn('[otp/email] Send failed', { error: e.message });
        return false;
    }
}

// ── WhatsApp via Twilio ───────────────────────────────────────────────────────

async function sendViaWhatsAppTwilio(phone, otp) {
    const sid  = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886
    if (!sid || !token || !from) return false;

    let twilio;
    try { twilio = require('twilio'); } catch { return false; }

    try {
        await twilio(sid, token).messages.create({
            body: `🌾 *FarmRent OTP*\n\nYour verification code is:\n\n*${otp}*\n\nValid for 10 minutes. Do not share this code with anyone.`,
            from,
            to: `whatsapp:+91${phone}`,
        });
        return true;
    } catch (e) {
        logger.warn('[otp/whatsapp-twilio] Send failed', { error: e.message });
        return false;
    }
}

// ── WhatsApp via Meta Cloud API ───────────────────────────────────────────────

async function sendViaWhatsAppMeta(phone, otp) {
    const token         = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const templateName  = process.env.WHATSAPP_TEMPLATE_NAME || 'farmrent_otp';
    if (!token || !phoneNumberId) return false;

    try {
        const resp = await fetch(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: `91${phone}`,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: 'en' },
                        components: [{
                            type: 'body',
                            parameters: [{ type: 'text', text: otp }],
                        }],
                    },
                }),
            }
        );
        const data = await resp.json();
        if (data?.messages?.[0]?.id) return true;
        logger.warn('[otp/whatsapp-meta] Send failed', { response: data });
        return false;
    } catch (e) {
        logger.warn('[otp/whatsapp-meta] Request failed', { error: e.message });
        return false;
    }
}

// ── MSG91 SMS ─────────────────────────────────────────────────────────────────

function msg91Request(path, payload, authKey, hostname = 'api.msg91.com') {
    return new Promise((resolve) => {
        const https = require('https');
        const body  = JSON.stringify(payload);
        const req   = https.request({
            hostname,
            path,
            method: 'POST',
            headers: {
                'Content-Type':   'application/json',
                authkey:          authKey,
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 10000,
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
        });
        req.on('timeout', () => { req.destroy(); resolve({}); });
        req.on('error',   () => resolve({}));
        req.write(body);
        req.end();
    });
}

async function sendViaMSG91(phone, otp) {
    const authKey    = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;
    if (!authKey) return false;

    const payload = { mobile: `91${phone}`, otp };
    if (templateId) payload.template_id = templateId;

    const data = await msg91Request('/api/v5/otp', payload, authKey, 'control.msg91.com');
    if (data.type === 'success') return true;
    logger.warn('[otp/msg91] Send failed', { response: data });
    return false;
}

// ── Twilio SMS ────────────────────────────────────────────────────────────────

async function sendViaTwilioSMS(phone, otp) {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_FROM;
    if (!sid || !token || !from) return false;

    let twilio;
    try { twilio = require('twilio'); } catch { return false; }

    try {
        await twilio(sid, token).messages.create({
            body: `Your FarmRent OTP is ${otp}. Valid for 10 minutes. Do not share.`,
            from,
            to: `+91${phone}`,
        });
        return true;
    } catch (e) {
        logger.warn('[otp/twilio-sms] Send failed', { error: e.message });
        return false;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function createOTP() {
    const otp    = generateOTP();
    const hash   = await bcrypt.hash(otp, 6);
    const expiry = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();
    return { otp, hash, expiry };
}

/**
 * Sends OTP — email first, then WhatsApp, then SMS fallbacks.
 * @param {string} phone - 10-digit Indian mobile number
 * @param {string} otp   - generated OTP string
 * @param {string} [email] - user email for email delivery (highest priority)
 * Returns the provider name: 'email' | 'whatsapp-twilio' | 'whatsapp-meta' | 'msg91' | 'twilio' | 'console'
 */
async function sendOTP(phone, otp, email) {
    if (phone.length !== 10 || !/^[6-9]\d{9}$/.test(phone)) {
        throw new Error('Invalid Indian mobile number');
    }

    if (email && await sendViaEmail(email, otp)) {
        logger.info('[otp] Sent via Email', { email: email.replace(/(.{2}).*(@.*)/, '$1***$2') });
        return 'email';
    }
    if (await sendViaWhatsAppTwilio(phone, otp)) {
        logger.info('[otp] Sent via WhatsApp (Twilio)', { phone: `****${phone.slice(-4)}` });
        return 'whatsapp-twilio';
    }
    if (await sendViaWhatsAppMeta(phone, otp)) {
        logger.info('[otp] Sent via WhatsApp (Meta)', { phone: `****${phone.slice(-4)}` });
        return 'whatsapp-meta';
    }
    if (await sendViaMSG91(phone, otp)) {
        logger.info('[otp] Sent via MSG91 SMS', { phone: `****${phone.slice(-4)}` });
        return 'msg91';
    }
    if (await sendViaTwilioSMS(phone, otp)) {
        logger.info('[otp] Sent via Twilio SMS', { phone: `****${phone.slice(-4)}` });
        return 'twilio';
    }

    if (process.env.NODE_ENV !== 'production') {
        const bar = '─'.repeat(55);
        logger.warn(`\n${bar}\n📱 DEV OTP for +91${phone}:  ${otp}  (valid 10 min)\n${bar}`);
        return 'console';
    }

    throw new Error('No OTP provider configured.');
}

async function verifyOTP(submittedOtp, storedHash, expiry, attempts) {
    if (!storedHash || !expiry) return false;
    if (attempts >= MAX_ATTEMPTS)     return false;
    if (new Date(expiry) < new Date()) return false;
    return bcrypt.compare(String(submittedOtp), storedHash);
}

async function sendSMS(phone, message) {
    if (!phone || !/^[6-9]\d{9}$/.test(phone)) return false;

    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_FROM;
    if (sid && token && from) {
        try {
            let twilio;
            try { twilio = require('twilio'); } catch { /* not installed */ }
            if (twilio) {
                await twilio(sid, token).messages.create({ body: message, from, to: `+91${phone}` });
                logger.info('[sms] Sent via Twilio', { phone: `****${phone.slice(-4)}` });
                return true;
            }
        } catch (e) {
            logger.warn('[sms/twilio] Send failed', { error: e.message });
        }
    }

    const authKey  = process.env.MSG91_AUTH_KEY;
    const senderId = process.env.MSG91_SENDER_ID || 'FRMRNT';
    if (authKey) {
        try {
            const url = `https://api.msg91.com/api/sendhttp.php?authkey=${authKey}&mobiles=91${phone}&message=${encodeURIComponent(message)}&sender=${senderId}&route=4`;
            const resp = await fetch(url);
            const text = await resp.text();
            if (text.startsWith('success')) {
                logger.info('[sms] Sent via MSG91', { phone: `****${phone.slice(-4)}` });
                return true;
            }
        } catch (e) {
            logger.warn('[sms/msg91] Request failed', { error: e.message });
        }
    }

    return false;
}

module.exports = { createOTP, sendOTP, verifyOTP, sendSMS, OTP_LENGTH, OTP_EXPIRY_MS };
