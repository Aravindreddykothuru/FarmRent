'use strict';

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const supabase = require('../lib/supabase');
const { getJwtSecret } = require('../lib/jwtSecret');
const emailService = require('../lib/emailService');
const { createOTP, sendOTP, verifyOTP, sendSMS } = require('../lib/otpService');
const logger   = require('../lib/logger');
const { redisClient } = require('../services/tracking-service/redisClient');

const REFRESH_TOKEN_EXPIRY_SEC  = 7 * 24 * 60 * 60;   // 7 days
const EMAIL_VERIFY_EXPIRY_SEC   = 24 * 60 * 60;        // 24 hours
const PASSWORD_RESET_EXPIRY_SEC = 60 * 60;             // 1 hour
const REG_OTP_EXPIRY_SEC        = 10 * 60;             // 10 minutes
const REG_VERIFIED_EXPIRY_SEC   = 30 * 60;             // 30 minutes to complete registration
const BCRYPT_ROUNDS             = 12;

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS  = 15 * 60 * 1000;

// In-memory login rate limiter (per-email)
const loginAttempts = new Map();

function getLoginState(email) {
    const key   = email.toLowerCase();
    const now   = Date.now();
    const state = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
    if (state.lockedUntil && now > state.lockedUntil) {
        loginAttempts.delete(key);
        return { count: 0, lockedUntil: 0 };
    }
    return state;
}

function recordFailedLogin(email) {
    const key   = email.toLowerCase();
    const state = getLoginState(email);
    const count = state.count + 1;
    const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOCKOUT_WINDOW_MS : 0;
    loginAttempts.set(key, { count, lockedUntil });
    return { count, lockedUntil };
}

function clearLoginAttempts(email) {
    loginAttempts.delete(email.toLowerCase());
}

// ── In-memory fallback token store (used when Redis is unavailable) ───────────
// Keyed by the same strings as Redis so the rest of the controller is unchanged.
// Entries expire naturally — checked on every get call.
const _memStore = new Map();

function _memCleanup() {
    const now = Date.now();
    for (const [k, v] of _memStore) {
        if (now > v.expiresAt) _memStore.delete(k);
    }
}

// ── Redis helpers (with transparent in-memory fallback) ───────────────────────

async function redisSet(key, value, ttlSec) {
    try {
        await redisClient.set(key, JSON.stringify(value), { EX: ttlSec });
    } catch (e) {
        // Redis unavailable — store in process memory (dev / single-instance only)
        logger.warn('[redis] set failed — using memory fallback', { key });
        _memStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    }
}

async function redisGet(key) {
    try {
        const raw = await redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        logger.warn('[redis] get failed — checking memory fallback', { key });
        _memCleanup();
        const entry = _memStore.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) { _memStore.delete(key); return null; }
        return entry.value;
    }
}

async function redisDel(key) {
    try { await redisClient.del(key); } catch { /* ignore */ }
    _memStore.delete(key);
}

async function redisKeys(pattern) {
    try { return await redisClient.keys(pattern); } catch {
        // Build a simple glob-to-regex for the rfsh:* pattern used by resetPassword
        const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        return [..._memStore.keys()].filter(k => regex.test(k));
    }
}

// ── JWT / sanitize ─────────────────────────────────────────────────────────────

const signToken = (user) => {
    const id = user?.id ?? user?.sub;
    if (id == null || !user?.email) throw new Error('Invalid user payload for token');
    return jwt.sign(
        { sub: String(id), email: user.email, role: user.role || 'farmer' },
        getJwtSecret(),
        { expiresIn: '15m' }
    );
};

const sanitize = (user) => {
    if (!user || typeof user !== 'object') return user;
    const {
        password_hash: _ph, email_verify_token: _vt, email_verify_expiry: _ve,
        password_reset_token: _rt, password_reset_expiry: _re,
        phone_otp_hash: _oh, phone_otp_expiry: _oe, otp_attempts: _oa,
        ...rest
    } = user;
    return rest;
};

// ── Refresh token (Redis) ──────────────────────────────────────────────────────

async function issueRefreshToken(userId, res) {
    const raw  = crypto.randomBytes(64).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');

    // Store in Redis with 7-day TTL
    await redisSet(`rfsh:${hash}`, { userId, issuedAt: Date.now() }, REFRESH_TOKEN_EXPIRY_SEC);

    res.cookie('rfsh', raw, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   REFRESH_TOKEN_EXPIRY_SEC * 1000,
        path:     '/api/v1/auth/refresh',
    });
}

// ── Email verification (Redis) ─────────────────────────────────────────────────

async function sendVerificationEmail(user) {
    const token = crypto.randomBytes(32).toString('hex');
    await redisSet(`emailverify:${token}`, { userId: user.id }, EMAIL_VERIFY_EXPIRY_SEC);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const link    = `${baseUrl}/verify-email?token=${token}`;

    if (process.env.NODE_ENV !== 'production') {
        const bar = '═'.repeat(65);
        logger.warn(`\n${bar}\n✅ DEV — Email verification link for ${user.email}:\n\n  ➜  ${link}\n\n${bar}`);
    }

    await emailService.sendVerificationEmail(user.email, { userName: user.name, link });
}

// ─── REGISTER ─────────────────────────────────────────────────────────────────
exports.register = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { email, password, name, role = 'farmer', phone } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        if (!phone) return res.status(400).json({ error: 'Phone number is required' });

        // Email must have been verified via OTP before registration
        const emailVerified = await redisGet(`reg-email-verified:${email.toLowerCase()}`);
        if (!emailVerified) {
            return res.status(400).json({ error: 'Email not verified. Please verify your email with OTP first.' });
        }

        const { data: existing } = await supabase
            .from('users').select('id').eq('email', email).maybeSingle();
        if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

        const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const insertData = {
            email,
            name: name || email.split('@')[0],
            role,
            password_hash,
            phone,
        };

        const { data: user, error: insErr } = await supabase
            .from('users')
            .insert(insertData)
            .select()
            .single();

        if (insErr) {
            if (insErr.code === '23505') return res.status(409).json({ error: 'An account with this email already exists' });
            logger.error('[auth/register] DB insert failed', { error: insErr.message });
            return res.status(400).json({ error: insErr.message || 'Could not create account' });
        }

        redisDel(`reg-email-verified:${email.toLowerCase()}`).catch(() => {});

        // Fire-and-forget verification email (never block registration)
        sendVerificationEmail(user).catch(e => logger.warn('[auth/register] email verify failed', { error: e.message }));

        await issueRefreshToken(user.id, res);
        return res.status(201).json({
            token:   signToken(user),
            user:    sanitize(user),
            message: 'Registration successful. Please verify your email.',
        });
    } catch (err) { next(err); }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        const loginState = getLoginState(email);
        if (loginState.lockedUntil && Date.now() < loginState.lockedUntil) {
            const retryAfterSec = Math.ceil((loginState.lockedUntil - Date.now()) / 1000);
            res.set('Retry-After', String(retryAfterSec));
            return res.status(429).json({
                error: `Too many failed attempts. Account locked for ${Math.ceil(retryAfterSec / 60)} minute(s).`,
                retryAfterSeconds: retryAfterSec,
            });
        }

        // Only select columns that actually exist
        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, name, role, phone, avatar_url, password_hash')
            .eq('email', email)
            .maybeSingle();

        if (error) {
            logger.error('[auth/login] DB query failed', { error: error.message });
            return res.status(400).json({ error: 'Login failed. Please try again.' });
        }

        if (!user) {
            recordFailedLogin(email);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            const { count, lockedUntil } = recordFailedLogin(email);
            const remaining = MAX_LOGIN_ATTEMPTS - count;
            if (lockedUntil) {
                return res.status(429).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
            }
            return res.status(401).json({
                error: `Invalid email or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
            });
        }

        clearLoginAttempts(email);

        await issueRefreshToken(user.id, res);
        return res.json({ token: signToken(user), user: sanitize(user) });
    } catch (err) { next(err); }
};

// ─── REFRESH ──────────────────────────────────────────────────────────────────
exports.refreshAccessToken = async (req, res, next) => {
    try {
        const raw = req.cookies?.rfsh;
        if (!raw) return res.status(401).json({ error: 'No refresh token' });

        const hash     = crypto.createHash('sha256').update(raw).digest('hex');
        const tokenRow = await redisGet(`rfsh:${hash}`);

        if (!tokenRow) {
            res.clearCookie('rfsh', { path: '/api/v1/auth/refresh' });
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user } = await supabase
            .from('users')
            .select('id, email, name, role, phone, avatar_url')
            .eq('id', tokenRow.userId)
            .maybeSingle();

        if (!user) return res.status(401).json({ error: 'User not found' });

        await redisDel(`rfsh:${hash}`);
        await issueRefreshToken(user.id, res);

        return res.json({ token: signToken(user), user: sanitize(user) });
    } catch (err) { next(err); }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
    try {
        const raw = req.cookies?.rfsh;
        if (raw) {
            const hash = crypto.createHash('sha256').update(raw).digest('hex');
            await redisDel(`rfsh:${hash}`);
        }
        res.clearCookie('rfsh', { path: '/api/v1/auth/refresh' });
        return res.json({ success: true });
    } catch (err) { next(err); }
};

// ─── ME ───────────────────────────────────────────────────────────────────────
exports.me = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const uid = req.user?.id || req.user?.sub;
        if (!uid) return res.status(401).json({ error: 'Unauthorized' });

        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, name, role, phone, avatar_url, created_at, updated_at')
            .eq('id', uid)
            .maybeSingle();

        if (error) return res.status(400).json({ error: error.message || 'Request failed' });
        if (!user) return res.status(404).json({ error: 'User not found' });

        return res.json({ success: true, user: sanitize(user) });
    } catch (err) { next(err); }
};

// ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.body || req.query || {};
        if (!token) return res.status(400).json({ error: 'Verification token is required' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const row = await redisGet(`emailverify:${token}`);
        if (!row) return res.status(400).json({ error: 'Invalid or expired verification link' });

        // Mark in Redis that this user is verified (optional, for future use)
        await redisDel(`emailverify:${token}`);
        await redisSet(`emailverified:${row.userId}`, true, 365 * 24 * 60 * 60);

        return res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
    } catch (err) { next(err); }
};

// ─── RESEND VERIFICATION EMAIL ────────────────────────────────────────────────
exports.resendVerification = async (req, res, next) => {
    try {
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ error: 'Email is required' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('email', email)
            .maybeSingle();

        // Always 200 to prevent email enumeration
        if (user) {
            sendVerificationEmail(user).catch(e => logger.warn('[auth/resend-verify] email failed', { error: e.message }));
        }

        return res.json({ success: true, message: 'If that email exists and is unverified, a new link has been sent.' });
    } catch (err) { next(err); }
};

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email, phone } = req.body || {};
        if (!email && !phone) return res.status(400).json({ error: 'Email or phone number is required' });
        if (!supabase)         return res.status(503).json({ error: 'Database not configured' });

        let targetEmail = email ? email.trim().toLowerCase() : null;
        let targetPhone = null; // 10-digit Indian mobile, set when request came via phone

        if (!targetEmail && phone) {
            const digits     = phone.replace(/\D/g, '');
            const normalised = digits.length === 12 && digits.startsWith('91')
                ? digits.slice(2)
                : digits.length === 13 && digits.startsWith('091')
                ? digits.slice(3)
                : digits;

            if (normalised.length !== 10) {
                return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
            }

            const { data: byPhone } = await supabase
                .from('users')
                .select('id, email, name')
                .or(`phone.eq.${normalised},phone.eq.+91${normalised},phone.eq.91${normalised}`)
                .maybeSingle();

            if (!byPhone) {
                return res.status(404).json({ error: 'No account found with this phone number.' });
            }
            targetEmail = byPhone.email;
            targetPhone = normalised; // remember so we can SMS the link
        }

        const { data: user } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('email', targetEmail)
            .maybeSingle();

        if (user) {
            const token = crypto.randomBytes(32).toString('hex');

            // Store reset token in Redis (with in-memory fallback when Redis is down)
            await redisSet(`pwreset:${token}`, { userId: user.id, email: user.email, name: user.name }, PASSWORD_RESET_EXPIRY_SEC);

            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
            const link    = `${baseUrl}/reset-password?token=${token}`;

            // In dev, print the link directly so you can test without opening your inbox
            if (process.env.NODE_ENV !== 'production') {
                const bar = '═'.repeat(65);
                logger.warn(`\n${bar}\n🔐 DEV — Password reset link for ${user.email}:\n\n  ➜  ${link}\n\n${bar}`);
            }

            // Always send reset email
            emailService.sendPasswordResetEmail(user.email, { userName: user.name, link })
                .catch(e => logger.warn('[auth/forgot-password] email failed', { error: e.message }));

            // When request came via phone, also send SMS with reset link
            if (targetPhone) {
                const smsText = `FarmRent: Reset your password using this link: ${link}  (valid 1 hour). Ignore if not requested.`;
                sendSMS(targetPhone, smsText)
                    .then(sent => {
                        if (sent) logger.info('[auth/forgot-password] SMS sent', { phone: `****${targetPhone.slice(-4)}` });
                        else      logger.info('[auth/forgot-password] SMS skipped — no provider configured (console link printed above)');
                    })
                    .catch(e => logger.warn('[auth/forgot-password] SMS failed', { error: e.message }));
            }
        }

        return res.json({ success: true, message: 'If that account exists, a reset link has been sent.' });
    } catch (err) { next(err); }
};

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body || {};
        if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const row = await redisGet(`pwreset:${token}`);
        if (!row) return res.status(400).json({ error: 'Invalid or expired reset link' });

        const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const { error: updErr } = await supabase
            .from('users')
            .update({ password_hash })
            .eq('id', row.userId);

        if (updErr) {
            logger.error('[auth/reset-password] DB update failed', { error: updErr.message });
            return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
        }

        // Invalidate the reset token
        await redisDel(`pwreset:${token}`);

        // Invalidate all refresh tokens for this user
        const rfshKeys = await redisKeys(`rfsh:*`);
        for (const k of rfshKeys) {
            const v = await redisGet(k);
            if (v?.userId === row.userId) await redisDel(k);
        }

        return res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
    } catch (err) { next(err); }
};

// ─── SEND PHONE OTP ───────────────────────────────────────────────────────────
exports.sendPhoneOTP = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const uid   = req.user?.id || req.user?.sub;
        const phone = req.body?.phone || req.user?.phone;
        if (!phone) return res.status(400).json({ error: 'Phone number is required' });

        const { data: user } = await supabase
            .from('users').select('id').eq('id', uid).maybeSingle();
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Check if already verified (in Redis)
        const verified = await redisGet(`phoneverified:${uid}`);
        if (verified) return res.json({ success: true, message: 'Phone already verified' });

        const { otp, hash, expiry } = await createOTP();
        await redisSet(`otp:${uid}`, { hash, expiry, attempts: 0 }, 10 * 60);

        // Also update phone number in DB if provided (fire-and-forget)
        if (phone) {
            supabase.from('users').update({ phone }).eq('id', uid).then(null, () => {});
        }

        const provider = await sendOTP(phone, otp);
        const devOtp = (provider === 'console') ? otp : undefined;
        return res.json({
            success: true,
            message: `OTP sent to ****${phone.slice(-4)}`,
            ...(devOtp && { devOtp, devNote: 'No SMS provider configured — OTP shown here for development only' }),
        });
    } catch (err) {
        logger.error('[auth/send-otp]', { error: err.message });
        return res.status(500).json({ error: err.message || 'Failed to send OTP' });
    }
};

// ─── VERIFY PHONE OTP ─────────────────────────────────────────────────────────
exports.verifyPhoneOTP = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const uid = req.user?.id || req.user?.sub;
        const { otp } = req.body || {};
        if (!otp) return res.status(400).json({ error: 'OTP is required' });

        const otpData = await redisGet(`otp:${uid}`);
        if (!otpData) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });

        // Increment attempt
        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`otp:${uid}`, otpData, 10 * 60);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                error: remaining > 0
                    ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                    : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        await redisDel(`otp:${uid}`);
        await redisSet(`phoneverified:${uid}`, true, 365 * 24 * 60 * 60);

        return res.json({ success: true, message: 'Phone number verified successfully.' });
    } catch (err) { next(err); }
};

// ─── REGISTRATION PHONE OTP — SEND (no auth) ─────────────────────────────────
exports.regSendOTP = async (req, res, next) => {
    try {
        const { phone, email } = req.body || {};
        if (!phone) return res.status(400).json({ error: 'Phone number is required' });

        // Reject if phone already registered
        if (supabase) {
            const { data: existing } = await supabase
                .from('users')
                .select('id')
                .or(`phone.eq.${phone},phone.eq.+91${phone},phone.eq.91${phone}`)
                .maybeSingle();
            if (existing) return res.status(409).json({ error: 'This phone number is already registered.' });
        }

        const { otp, hash, expiry } = await createOTP();
        await redisSet(`reg-otp:${phone}`, { hash, expiry, attempts: 0 }, REG_OTP_EXPIRY_SEC);

        const provider = await sendOTP(phone, otp, email);
        const viaEmail    = provider === 'email';
        const viaWhatsApp = provider === 'whatsapp-twilio' || provider === 'whatsapp-meta';
        const devOtp = (provider === 'console') ? otp : undefined;
        return res.json({
            success: true,
            message: viaEmail
                ? `OTP sent to ${email}`
                : viaWhatsApp
                    ? `OTP sent to your WhatsApp (****${phone.slice(-4)})`
                    : `OTP sent to ****${phone.slice(-4)}`,
            channel: viaEmail ? 'email' : viaWhatsApp ? 'whatsapp' : 'sms',
            ...(devOtp && { devOtp, devNote: 'No provider configured — OTP shown here for development only' }),
        });
    } catch (err) {
        logger.error('[auth/reg-send-otp]', { error: err.message });
        return res.status(500).json({ error: err.message || 'Failed to send OTP' });
    }
};

// ─── REGISTRATION EMAIL OTP — SEND (no auth) ─────────────────────────────────
exports.regEmailSendOTP = async (req, res, next) => {
    try {
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ error: 'Email is required' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: existing } = await supabase
            .from('users').select('id').eq('email', email.toLowerCase().trim()).maybeSingle();
        if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

        const { otp, hash, expiry } = await createOTP();
        await redisSet(`reg-email-otp:${email.toLowerCase()}`, { hash, expiry, attempts: 0 }, REG_OTP_EXPIRY_SEC);

        await emailService.send({
            to:      email,
            subject: '🌾 FarmRent — Verify your email to register',
            html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
  <div style="background:#166534;padding:24px 32px;"><span style="color:#fff;font-size:22px;font-weight:900;">🌾 FarmRent</span></div>
  <div style="padding:32px;">
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Verify your email</h2>
    <p style="color:#6b7280;margin:0 0 28px;">Use this OTP to verify your email and create your FarmRent account. Expires in <strong>10 minutes</strong>.</p>
    <div style="background:#f0fdf4;border:2px dashed #16a34a;border-radius:10px;padding:24px;text-align:center;margin-bottom:28px;">
      <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#166534;">${otp}</span>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:0;">Do not share this code. FarmRent will never ask for your OTP.</p>
  </div>
</div>`,
        });

        logger.info('[auth/reg-email-otp] OTP sent', { email: email.replace(/(.{2}).*(@.*)/, '$1***$2') });
        return res.json({
            success: true,
            message: `OTP sent to ${email}`,
            ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
        });
    } catch (err) { next(err); }
};

// ─── REGISTRATION EMAIL OTP — VERIFY (no auth) ───────────────────────────────
exports.regEmailVerifyOTP = async (req, res, next) => {
    try {
        const { email, otp } = req.body || {};
        if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

        const otpData = await redisGet(`reg-email-otp:${email.toLowerCase()}`);
        if (!otpData) return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });

        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`reg-email-otp:${email.toLowerCase()}`, otpData, REG_OTP_EXPIRY_SEC);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                error: remaining > 0
                    ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                    : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        await redisDel(`reg-email-otp:${email.toLowerCase()}`);
        await redisSet(`reg-email-verified:${email.toLowerCase()}`, true, REG_VERIFIED_EXPIRY_SEC);
        return res.json({ success: true, message: 'Email verified.' });
    } catch (err) { next(err); }
};

// ─── LOGIN VIA EMAIL OTP — SEND (no auth) ────────────────────────────────────
exports.loginSendOTP = async (req, res, next) => {
    try {
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ error: 'Email is required' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user } = await supabase
            .from('users')
            .select('id, email, name')
            .eq('email', email.toLowerCase().trim())
            .maybeSingle();

        let devOtp;
        if (user) {
            const { otp, hash, expiry } = await createOTP();
            await redisSet(`login-otp:${user.id}`, { hash, expiry, attempts: 0 }, 10 * 60);

            await emailService.send({
                to:      user.email,
                subject: '🌾 FarmRent — Login OTP',
                html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
  <div style="background:#166534;padding:24px 32px;"><span style="color:#fff;font-size:22px;font-weight:900;">🌾 FarmRent</span></div>
  <div style="padding:32px;">
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Login verification code</h2>
    <p style="color:#6b7280;margin:0 0 28px;">Use this OTP to sign in to FarmRent. It expires in <strong>10 minutes</strong>.</p>
    <div style="background:#f0fdf4;border:2px dashed #16a34a;border-radius:10px;padding:24px;text-align:center;margin-bottom:28px;">
      <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#166534;">${otp}</span>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:0;">Do not share this code. FarmRent will never ask for your OTP.</p>
  </div>
</div>`,
            });

            logger.info('[auth/login-otp] OTP sent', { userId: user.id });
            if (process.env.NODE_ENV !== 'production') devOtp = otp;
        }

        return res.json({
            success: true,
            message: `If an account exists for ${email}, an OTP has been sent.`,
            ...(devOtp && { devOtp }),
        });
    } catch (err) { next(err); }
};

// ─── LOGIN VIA EMAIL OTP — VERIFY (no auth) ──────────────────────────────────
exports.loginVerifyOTP = async (req, res, next) => {
    try {
        const { email, otp } = req.body || {};
        if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user } = await supabase
            .from('users')
            .select('id, email, name, role, phone, avatar_url')
            .eq('email', email.toLowerCase().trim())
            .maybeSingle();

        if (!user) return res.status(401).json({ error: 'Invalid OTP' });

        const otpData = await redisGet(`login-otp:${user.id}`);
        if (!otpData) return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });

        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`login-otp:${user.id}`, otpData, 10 * 60);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                error: remaining > 0
                    ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                    : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        await redisDel(`login-otp:${user.id}`);
        clearLoginAttempts(email);
        await issueRefreshToken(user.id, res);
        return res.json({ token: signToken(user), user: sanitize(user) });
    } catch (err) { next(err); }
};

// ─── REGISTRATION PHONE OTP — VERIFY (no auth) ───────────────────────────────
exports.regVerifyOTP = async (req, res, next) => {
    try {
        const { phone, otp } = req.body || {};
        if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required' });

        const otpData = await redisGet(`reg-otp:${phone}`);
        if (!otpData) return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });

        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`reg-otp:${phone}`, otpData, REG_OTP_EXPIRY_SEC);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                error: remaining > 0
                    ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                    : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        await redisDel(`reg-otp:${phone}`);
        // Mark phone as verified — user has 30 min to complete registration
        await redisSet(`reg-verified:${phone}`, true, REG_VERIFIED_EXPIRY_SEC);

        return res.json({ success: true, message: 'Phone number verified.' });
    } catch (err) { next(err); }
};
