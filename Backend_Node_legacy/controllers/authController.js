'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { getJwtSecret } = require('../lib/jwtSecret');
const emailService = require('../lib/emailService');
const { createOTP, sendOTP, verifyOTP, sendSMS } = require('../lib/otpService');
const logger = require('../lib/logger');
const { redisClient } = require('../services/tracking-service/redisClient');
const { recordFailure, isLocked, clearFailures } = require('../lib/loginAttemptService');
const cacheManager = require('../lib/cacheManager');
const { ROLE_IDS, USER_ROLES_SELECT, sortRoles, rolesFromUserRow } = require('../lib/roles');
const sessionService = require('../services/auth-service/sessionService');

// Token TTLs (spec: 15 min access, 30 days refresh)
const ACCESS_TOKEN_EXPIRY_SEC = 15 * 60;
const REFRESH_TOKEN_EXPIRY_SEC = 30 * 24 * 60 * 60;
const EMAIL_VERIFY_EXPIRY_SEC = 24 * 60 * 60;
const PASSWORD_RESET_EXPIRY_SEC = 60 * 60;
const REG_OTP_EXPIRY_SEC = 10 * 60;
const REG_VERIFIED_EXPIRY_SEC = 30 * 60;
const OAUTH_STATE_EXPIRY_SEC = 10 * 60;
const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS_BEFORE_LOCK = 5;
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$.{53}$/;

// Compared against when an account does not exist, so login timing does not reveal registered emails.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), BCRYPT_ROUNDS);

const isProduction = () => process.env.NODE_ENV === 'production';
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

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
        if (!redisClient?.isReady) {
            throw new Error('Redis client not ready');
        }
        await redisClient.set(key, JSON.stringify(value), { EX: ttlSec });
    } catch (e) {
        // Redis unavailable — store in process memory (dev / single-instance only)
        logger.warn('[redis] set failed — using memory fallback', { key, error: e.message });
        _memStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    }
}

async function redisGet(key) {
    try {
        if (!redisClient?.isReady) {
            throw new Error('Redis client not ready');
        }
        const raw = await redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        logger.warn('[redis] get failed — checking memory fallback', { key, error: e.message });
        _memCleanup();
        const entry = _memStore.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            _memStore.delete(key);
            return null;
        }
        return entry.value;
    }
}

async function redisDel(key) {
    try {
        if (redisClient?.isReady) {
            await redisClient.del(key);
        }
    } catch (e) {
        logger.warn('[redis] del failed', { key, error: e.message });
    }
    _memStore.delete(key);
}

async function redisKeys(pattern) {
    try {
        const keys = [];
        if (redisClient?.isReady) {
            for await (const key of redisClient.scanIterator({
                MATCH: pattern,
                COUNT: 100,
            })) {
                keys.push(key);
            }
        }
        return keys;
    } catch (err) {
        logger.warn('[auth] redis SCAN failed, falling back to memStore keys', { error: err.message });
        const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        return [..._memStore.keys()].filter((k) => regex.test(k));
    }
}

async function revokeRefreshTokensForUser(userId) {
    for (const key of await redisKeys('rfsh:*')) {
        const value = await redisGet(key);
        if (value?.userId === userId) await redisDel(key);
    }
}

// ── JWT / sanitize ─────────────────────────────────────────────────────────────

const signToken = (user, sessionId) => {
    const id = user?.id ?? user?.sub;
    if (id == null || !user?.email) throw new Error('Invalid user payload for token');
    const roles = sortRoles(Array.isArray(user.roles) ? user.roles : [user.role]);
    if (roles.length === 0) throw new Error(`User ${id} has no valid role`);
    return jwt.sign(
        {
            sub: String(id),
            email: user.email,
            role: roles[0], // primary role (backward-compat)
            roles,
            sid: sessionId || undefined,
        },
        getJwtSecret(),
        { expiresIn: ACCESS_TOKEN_EXPIRY_SEC },
    );
};

/** Public view of a users row: no credentials, `name` alias, primary `role` and `roles`. */
const sanitize = (user) => {
    if (!user || typeof user !== 'object') return user;
    const { password_hash: _ph, user_roles: _ur, ...rest } = user;
    const roles = user.user_roles ? rolesFromUserRow(user) : sortRoles(Array.isArray(user.roles) ? user.roles : [user.role]);
    return { ...rest, name: user.full_name ?? user.name, role: roles[0], roles };
};

const authCookieOptions = (maxAgeSec, path = '/') => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    maxAge: maxAgeSec * 1000,
    path,
});

function clearAuthCookies(res) {
    res.clearCookie('rfsh', { path: '/api/v1/auth/refresh' });
    res.clearCookie('token', { path: '/' });
    res.clearCookie('authRole', { path: '/' });
}

// ── Refresh token (Redis) ──────────────────────────────────────────────────────

async function issueRefreshToken(userId, res, sessionId) {
    const raw = crypto.randomBytes(64).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');

    await redisSet(`rfsh:${hash}`, { userId, sessionId, issuedAt: Date.now() }, REFRESH_TOKEN_EXPIRY_SEC);
    res.cookie('rfsh', raw, authCookieOptions(REFRESH_TOKEN_EXPIRY_SEC, '/api/v1/auth/refresh'));
}

function issueAccessToken(user, res, sessionId) {
    const token = signToken(user, sessionId);
    res.cookie('token', token, authCookieOptions(ACCESS_TOKEN_EXPIRY_SEC));
    // Readable hint for the Next.js proxy's dashboard routing. Authorization always uses the signed token.
    res.cookie('authRole', sanitize(user).role, {
        secure: isProduction(),
        sameSite: 'lax',
        maxAge: REFRESH_TOKEN_EXPIRY_SEC * 1000,
        path: '/',
    });
    return token;
}

async function startSession(user, req, res) {
    const sessionId = await sessionService.createSession(user.id, req.ip, req.headers['user-agent']);
    await issueRefreshToken(user.id, res, sessionId);
    return issueAccessToken(user, res, sessionId);
}

function recordLogin(userId) {
    supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', userId)
        .then(
            ({ error }) => {
                if (error) logger.warn('[auth] failed to record last_login_at', { userId, error: error.message });
            },
            (err) => logger.warn('[auth] failed to record last_login_at', { userId, error: err.message }),
        );
}

// ── Email verification (Redis) ─────────────────────────────────────────────────

async function sendVerificationEmail(user) {
    const token = crypto.randomBytes(32).toString('hex');
    await redisSet(`emailverify:${token}`, { userId: user.id }, EMAIL_VERIFY_EXPIRY_SEC);

    const link = `${appUrl()}/verify-email?token=${token}`;

    if (!isProduction()) {
        const bar = '═'.repeat(65);
        logger.warn(`\n${bar}\n✅ DEV — Email verification link for ${user.email}:\n\n  ➜  ${link}\n\n${bar}`);
    }

    await emailService.sendVerificationEmail(user.email, { userName: user.full_name || user.name, link });
}

// ─── REGISTER ─────────────────────────────────────────────────────────────────
exports.register = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        // Body is validated by registerSchema: email is trimmed + lower-cased, role is farmer|owner.
        const { email, password, name, role, phone, village, district, state } = req.body;

        // Email must have been verified via OTP before registration
        const emailVerified = await redisGet(`reg-email-verified:${email}`);
        if (!emailVerified) {
            return res
                .status(400)
                .json({ code: 'EMAIL_NOT_VERIFIED', error: 'Email not verified. Please verify your email with OTP first.' });
        }

        const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const { data: user, error: insErr } = await supabase
            .from('users')
            .insert({
                email,
                full_name: name,
                password_hash,
                phone,
                village: village || null,
                district: district || null,
                state: state || null,
                // Verified via OTP before this step
                email_verified: true,
            })
            .select('id, email, full_name, phone, avatar_url, created_at')
            .single();

        if (insErr?.code === '23505') {
            const phoneTaken = /phone/i.test(`${insErr.details} ${insErr.message}`);
            return res.status(409).json({
                code: phoneTaken ? 'PHONE_TAKEN' : 'EMAIL_TAKEN',
                error: phoneTaken ? 'An account with this phone number already exists' : 'An account with this email already exists',
            });
        }
        if (insErr) throw insErr;

        const { error: roleErr } = await supabase.from('user_roles').insert({ user_id: user.id, role_id: ROLE_IDS[role] });
        if (roleErr) {
            // An account without a role cannot sign in; remove it so the person can simply register again.
            const { error: cleanupErr } = await supabase.from('users').delete().eq('id', user.id);
            if (cleanupErr) {
                logger.error('[auth/register] could not remove user after role assignment failed', {
                    userId: user.id,
                    error: cleanupErr.message,
                });
            }
            throw roleErr;
        }

        user.roles = [role];
        await redisDel(`reg-email-verified:${email}`);

        const token = await startSession(user, req, res);
        return res.status(201).json({
            token,
            user: sanitize(user),
            message: 'Registration successful.',
        });
    } catch (err) {
        next(err);
    }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { email, password } = req.body;

        // ── Progressive account lockout check (Redis-backed) ──────────────────
        const lockCheck = await isLocked(email);
        if (lockCheck.locked) {
            const minutes = Math.ceil(lockCheck.retryAfterSec / 60);
            res.set('Retry-After', String(lockCheck.retryAfterSec));
            return res.status(429).json({
                code: 'ACCOUNT_LOCKED',
                error: `Account locked due to too many failed attempts. Try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`,
                retryAfterSeconds: lockCheck.retryAfterSec,
            });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select(`id, email, full_name, phone, avatar_url, status, password_hash, ${USER_ROLES_SELECT}`)
            .eq('email', email)
            .maybeSingle();
        if (error) throw error;

        const storedHash = user && BCRYPT_HASH_RE.test(user.password_hash || '') ? user.password_hash : DUMMY_PASSWORD_HASH;
        const valid = await bcrypt.compare(password, storedHash);

        if (!user || !valid || storedHash === DUMMY_PASSWORD_HASH) {
            const { locked, lockMinutes, failCount } = await recordFailure(email);
            if (locked) {
                return res.status(429).json({
                    code: 'ACCOUNT_LOCKED',
                    error: `Too many failed attempts. Account locked for ${lockMinutes >= 1440 ? '24 hours' : `${lockMinutes} minutes`}.`,
                    retryAfterSeconds: lockMinutes * 60,
                });
            }
            const remaining = Math.max(0, MAX_FAILED_LOGINS_BEFORE_LOCK - failCount);
            return res.status(401).json({
                code: 'INVALID_CREDENTIALS',
                error:
                    remaining > 0
                        ? `Invalid email or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before lockout.`
                        : 'Too many failed attempts.',
            });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ code: 'ACCOUNT_DISABLED', error: 'This account has been disabled. Please contact support.' });
        }
        user.roles = rolesFromUserRow(user);
        if (user.roles.length === 0) {
            logger.error('[auth/login] account has no role assigned', { userId: user.id });
            return res
                .status(403)
                .json({ code: 'ACCOUNT_MISCONFIGURED', error: 'Your account is not fully set up. Please contact support.' });
        }

        await clearFailures(email);
        const token = await startSession(user, req, res);
        recordLogin(user.id);
        return res.json({ token, user: sanitize(user) });
    } catch (err) {
        next(err);
    }
};

// ─── REFRESH ──────────────────────────────────────────────────────────────────
exports.refreshAccessToken = async (req, res, next) => {
    try {
        const raw = req.cookies?.rfsh;
        if (!raw) return res.status(401).json({ code: 'NO_REFRESH_TOKEN', error: 'No refresh token' });

        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        const tokenRow = await redisGet(`rfsh:${hash}`);

        if (!tokenRow) {
            // A token that was already rotated being presented again means it leaked: end every session.
            const rotatedToken = await redisGet(`rotated_rfsh:${hash}`);
            if (rotatedToken) {
                logger.warn('[auth] Refresh token reuse detected — revoking all sessions', { userId: rotatedToken.userId });
                await sessionService.revokeAllSessions(rotatedToken.userId);
                await revokeRefreshTokensForUser(rotatedToken.userId);
                await redisDel(`rotated_rfsh:${hash}`);
                clearAuthCookies(res);
                return res
                    .status(401)
                    .json({ code: 'REFRESH_TOKEN_REUSED', error: 'Security breach detected. All sessions revoked. Please log in again.' });
            }

            clearAuthCookies(res);
            return res.status(401).json({ code: 'INVALID_REFRESH_TOKEN', error: 'Invalid or expired refresh token' });
        }

        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user, error } = await supabase
            .from('users')
            .select(`id, email, full_name, phone, avatar_url, status, ${USER_ROLES_SELECT}`)
            .eq('id', tokenRow.userId)
            .maybeSingle();
        if (error) throw error;

        if (!user || user.status !== 'active') {
            await redisDel(`rfsh:${hash}`);
            clearAuthCookies(res);
            return res.status(401).json({ code: 'ACCOUNT_UNAVAILABLE', error: 'Account not found or disabled' });
        }
        user.roles = rolesFromUserRow(user);

        let sessionId = tokenRow.sessionId;
        if (sessionId) {
            if (!(await sessionService.verifySession(sessionId))) {
                await redisDel(`rfsh:${hash}`);
                clearAuthCookies(res);
                return res.status(401).json({ code: 'SESSION_REVOKED', error: 'Session has been revoked or expired' });
            }
        } else {
            sessionId = await sessionService.createSession(user.id, req.ip, req.headers['user-agent']);
        }

        // Keep the rotated token briefly so a replay can be told apart from an unknown token.
        await redisSet(`rotated_rfsh:${hash}`, { userId: tokenRow.userId }, 120);
        await redisDel(`rfsh:${hash}`);

        await issueRefreshToken(user.id, res, sessionId);
        const token = issueAccessToken(user, res, sessionId);
        return res.json({ token, user: sanitize(user) });
    } catch (err) {
        next(err);
    }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
    try {
        if (req.user?.sid) {
            await sessionService.revokeSession(req.user.sid, req.user.id);
        }

        const raw = req.cookies?.rfsh;
        if (raw) {
            const hash = crypto.createHash('sha256').update(raw).digest('hex');
            await redisDel(`rfsh:${hash}`);
        }
        clearAuthCookies(res);

        if (req.user?.id) {
            await cacheManager.del(`user:profile:${req.user.id}`);
        }

        // Block the presented access token for the rest of its lifetime (header or cookie).
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;
        if (token) {
            const decoded = jwt.decode(token);
            if (decoded?.exp) {
                const { blockToken } = require('../lib/tokenBlocklist');
                await blockToken(token, decoded.exp);
            }
        }

        return res.json({ success: true });
    } catch (err) {
        next(err);
    }
};

// ─── ME ───────────────────────────────────────────────────────────────────────
exports.me = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const row = await cacheManager.remember(`user:profile:${req.user.id}`, 300, async () => {
            const { data, error } = await supabase
                .from('users')
                .select(
                    `id, email, full_name, phone, avatar_url, kyc_status, village, district, state, created_at, updated_at, ${USER_ROLES_SELECT}`,
                )
                .eq('id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            return data;
        });

        if (!row) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'User not found' });
        return res.json({ success: true, user: sanitize(row) });
    } catch (err) {
        next(err);
    }
};

// ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const row = await redisGet(`emailverify:${token}`);
        if (!row) return res.status(400).json({ code: 'INVALID_TOKEN', error: 'Invalid or expired verification link' });

        const { error } = await supabase.from('users').update({ email_verified: true }).eq('id', row.userId);
        if (error) throw error;
        await redisDel(`emailverify:${token}`);

        return res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
    } catch (err) {
        next(err);
    }
};

// ─── RESEND VERIFICATION EMAIL ────────────────────────────────────────────────
exports.resendVerification = async (req, res, next) => {
    try {
        const email = String(req.body.email).trim().toLowerCase();
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user, error } = await supabase
            .from('users')
            .select('id, full_name, email, email_verified')
            .eq('email', email)
            .maybeSingle();
        if (error) throw error;

        // Always 200 to prevent email enumeration
        if (user && !user.email_verified) {
            sendVerificationEmail(user).catch((e) => logger.warn('[auth/resend-verify] email failed', { error: e.message }));
        }

        return res.json({ success: true, message: 'If that email exists and is unverified, a new link has been sent.' });
    } catch (err) {
        next(err);
    }
};

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });
        const { email, phone } = req.body;
        const genericResponse = { success: true, message: 'If that account exists, a reset link has been sent.' };

        let query = supabase.from('users').select('id, full_name, email');
        query = email ? query.eq('email', email) : query.or(`phone.eq.${phone},phone.eq.+91${phone},phone.eq.91${phone}`);
        const { data: user, error } = await query.maybeSingle();
        if (error) throw error;

        // Same response whether or not the account exists, so this endpoint cannot be used to find accounts.
        if (!user) return res.json(genericResponse);

        const token = crypto.randomBytes(32).toString('hex');
        await redisSet(`pwreset:${token}`, { userId: user.id, email: user.email }, PASSWORD_RESET_EXPIRY_SEC);
        const link = `${appUrl()}/reset-password?token=${token}`;

        const delivered = await emailService.sendPasswordResetEmail(user.email, { userName: user.full_name, link });
        if (!delivered && isProduction()) {
            await redisDel(`pwreset:${token}`);
            return res.status(503).json({ code: 'EMAIL_UNAVAILABLE', error: 'Could not send reset email. Please try again later.' });
        }

        if (phone) {
            const sent = await sendSMS(
                phone,
                `FarmRent: Reset your password using this link: ${link}  (valid 1 hour). Ignore if not requested.`,
            );
            logger.info('[auth/forgot-password] reset SMS', { phone: `****${phone.slice(-4)}`, sent });
        }

        logger.info('[auth/forgot-password] reset email', { email: user.email.replace(/(.{2}).*(@.*)/, '$1***$2'), delivered });

        if (!isProduction()) {
            return res.json({ ...genericResponse, devResetLink: link, emailDelivered: delivered });
        }
        return res.json(genericResponse);
    } catch (err) {
        next(err);
    }
};

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const row = await redisGet(`pwreset:${token}`);
        if (!row) return res.status(400).json({ code: 'INVALID_TOKEN', error: 'Invalid or expired reset link' });

        const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const { error: updErr } = await supabase.from('users').update({ password_hash }).eq('id', row.userId);
        if (updErr) throw updErr;

        // A password reset ends every existing session, including ones an attacker may hold.
        await redisDel(`pwreset:${token}`);
        await revokeRefreshTokensForUser(row.userId);
        await sessionService.revokeAllSessions(row.userId);
        await cacheManager.del(`user:profile:${row.userId}`);

        return res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
    } catch (err) {
        next(err);
    }
};

// ─── SEND PHONE OTP (signed-in user verifying a number) ───────────────────────
exports.sendPhoneOTP = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const uid = req.user.id;
        const { phone } = req.body;

        const { data: user, error } = await supabase.from('users').select('id, phone, phone_verified').eq('id', uid).maybeSingle();
        if (error) throw error;
        if (!user) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'User not found' });
        if (user.phone === phone && user.phone_verified) return res.json({ success: true, message: 'Phone already verified' });

        const { data: taken, error: takenErr } = await supabase.from('users').select('id').eq('phone', phone).neq('id', uid).maybeSingle();
        if (takenErr) throw takenErr;
        if (taken) return res.status(409).json({ code: 'PHONE_TAKEN', error: 'This phone number is registered to another account' });

        const { otp, hash, expiry } = await createOTP();
        // The number is saved on the account only after the OTP proves ownership.
        await redisSet(`otp:${uid}`, { hash, expiry, attempts: 0, phone }, 10 * 60);

        const provider = await sendOTP(phone, otp);
        const devOtp = provider === 'console' && !isProduction() ? otp : undefined;
        return res.json({
            success: true,
            message: `OTP sent to ****${phone.slice(-4)}`,
            ...(devOtp && { devOtp, devNote: 'No SMS provider configured — OTP shown here for development only' }),
        });
    } catch (err) {
        next(err);
    }
};

// ─── VERIFY PHONE OTP ─────────────────────────────────────────────────────────
exports.verifyPhoneOTP = async (req, res, next) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const uid = req.user.id;
        const { otp } = req.body;

        const otpData = await redisGet(`otp:${uid}`);
        if (!otpData) return res.status(400).json({ code: 'OTP_NOT_FOUND', error: 'No OTP found. Please request a new one.' });

        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`otp:${uid}`, otpData, 10 * 60);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                code: 'INVALID_OTP',
                error:
                    remaining > 0
                        ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                        : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        const { error } = await supabase.from('users').update({ phone: otpData.phone, phone_verified: true }).eq('id', uid);
        if (error?.code === '23505')
            return res.status(409).json({ code: 'PHONE_TAKEN', error: 'This phone number is registered to another account' });
        if (error) throw error;

        await redisDel(`otp:${uid}`);
        await cacheManager.del(`user:profile:${uid}`);
        return res.json({ success: true, message: 'Phone number verified successfully.' });
    } catch (err) {
        next(err);
    }
};

// ─── REGISTRATION PHONE OTP — SEND (no auth) ─────────────────────────────────
exports.regSendOTP = async (req, res, next) => {
    try {
        const { phone, email } = req.body;

        if (supabase) {
            const { data: existing, error } = await supabase
                .from('users')
                .select('id')
                .or(`phone.eq.${phone},phone.eq.+91${phone},phone.eq.91${phone}`)
                .maybeSingle();
            if (error) throw error;
            if (existing) return res.status(409).json({ code: 'PHONE_TAKEN', error: 'This phone number is already registered.' });
        }

        const { otp, hash, expiry } = await createOTP();
        await redisSet(`reg-otp:${phone}`, { hash, expiry, attempts: 0 }, REG_OTP_EXPIRY_SEC);

        const provider = await sendOTP(phone, otp, email);
        const viaEmail = provider === 'email';
        const viaWhatsApp = provider === 'whatsapp-twilio' || provider === 'whatsapp-meta';
        const devOtp = provider === 'console' && !isProduction() ? otp : undefined;
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
        next(err);
    }
};

// ─── REGISTRATION EMAIL OTP — SEND (no auth) ─────────────────────────────────
exports.regEmailSendOTP = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: existing, error } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
        if (error) throw error;
        if (existing) return res.status(409).json({ code: 'EMAIL_TAKEN', error: 'An account with this email already exists' });

        const { otp, hash, expiry } = await createOTP();
        await redisSet(`reg-email-otp:${email}`, { hash, expiry, attempts: 0 }, REG_OTP_EXPIRY_SEC);

        const sent = await emailService.send({
            to: email,
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

        if (!sent && isProduction()) {
            await redisDel(`reg-email-otp:${email}`);
            return res.status(503).json({ code: 'EMAIL_UNAVAILABLE', error: 'Could not send email. Please try again later.' });
        }

        logger.info('[auth/reg-email-otp] OTP sent', { email: email.replace(/(.{2}).*(@.*)/, '$1***$2'), delivered: sent });
        return res.json({
            success: true,
            message: sent ? `OTP sent to ${email}` : 'Email delivery unavailable — use dev OTP below',
            ...(!isProduction() && { devOtp: otp }),
            ...(!sent &&
                !isProduction() && {
                    devNote: 'No email provider delivered — OTP shown here. View captured emails at /api/dev/emails',
                }),
        });
    } catch (err) {
        next(err);
    }
};

// ─── REGISTRATION EMAIL OTP — VERIFY (no auth) ───────────────────────────────
exports.regEmailVerifyOTP = async (req, res, next) => {
    try {
        const { email, otp } = req.body;

        const otpData = await redisGet(`reg-email-otp:${email}`);
        if (!otpData) return res.status(400).json({ code: 'OTP_NOT_FOUND', error: 'OTP expired or not found. Please request a new one.' });

        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`reg-email-otp:${email}`, otpData, REG_OTP_EXPIRY_SEC);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                code: 'INVALID_OTP',
                error:
                    remaining > 0
                        ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                        : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        await redisDel(`reg-email-otp:${email}`);
        await redisSet(`reg-email-verified:${email}`, true, REG_VERIFIED_EXPIRY_SEC);
        return res.json({ success: true, message: 'Email verified.' });
    } catch (err) {
        next(err);
    }
};

// ─── LOGIN VIA EMAIL OTP — SEND (no auth) ────────────────────────────────────
exports.loginSendOTP = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user, error } = await supabase.from('users').select('id, email, full_name').eq('email', email).maybeSingle();
        if (error) throw error;

        let devOtp;
        if (user) {
            const { otp, hash, expiry } = await createOTP();
            await redisSet(`login-otp:${user.id}`, { hash, expiry, attempts: 0 }, 10 * 60);

            const sent = await emailService.send({
                to: user.email,
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

            logger.info('[auth/login-otp] OTP sent', { userId: user.id, delivered: sent });
            if (!isProduction()) devOtp = otp;
        }

        return res.json({
            success: true,
            message: `If an account exists for ${email}, an OTP has been sent.`,
            ...(devOtp && { devOtp }),
        });
    } catch (err) {
        next(err);
    }
};

// ─── LOGIN VIA EMAIL OTP — VERIFY (no auth) ──────────────────────────────────
exports.loginVerifyOTP = async (req, res, next) => {
    try {
        const { email, otp } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { data: user, error } = await supabase
            .from('users')
            .select(`id, email, full_name, phone, avatar_url, status, ${USER_ROLES_SELECT}`)
            .eq('email', email)
            .maybeSingle();
        if (error) throw error;

        const otpData = user ? await redisGet(`login-otp:${user.id}`) : null;
        if (!otpData) return res.status(400).json({ code: 'OTP_NOT_FOUND', error: 'OTP expired or not found. Please request a new one.' });

        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`login-otp:${user.id}`, otpData, 10 * 60);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                code: 'INVALID_OTP',
                error:
                    remaining > 0
                        ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                        : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ code: 'ACCOUNT_DISABLED', error: 'This account has been disabled. Please contact support.' });
        }
        user.roles = rolesFromUserRow(user);
        if (user.roles.length === 0) {
            logger.error('[auth/login-otp] account has no role assigned', { userId: user.id });
            return res
                .status(403)
                .json({ code: 'ACCOUNT_MISCONFIGURED', error: 'Your account is not fully set up. Please contact support.' });
        }

        await redisDel(`login-otp:${user.id}`);
        await clearFailures(email);
        const token = await startSession(user, req, res);
        recordLogin(user.id);
        return res.json({ token, user: sanitize(user) });
    } catch (err) {
        next(err);
    }
};

// ─── REGISTRATION PHONE OTP — VERIFY (no auth) ───────────────────────────────
exports.regVerifyOTP = async (req, res, next) => {
    try {
        const { phone, otp } = req.body;

        const otpData = await redisGet(`reg-otp:${phone}`);
        if (!otpData) return res.status(400).json({ code: 'OTP_NOT_FOUND', error: 'OTP expired or not found. Please request a new one.' });

        otpData.attempts = (otpData.attempts || 0) + 1;
        await redisSet(`reg-otp:${phone}`, otpData, REG_OTP_EXPIRY_SEC);

        const valid = await verifyOTP(otp, otpData.hash, otpData.expiry, otpData.attempts - 1);
        if (!valid) {
            const remaining = Math.max(0, 4 - otpData.attempts);
            return res.status(400).json({
                code: 'INVALID_OTP',
                error:
                    remaining > 0
                        ? `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                        : 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        await redisDel(`reg-otp:${phone}`);
        // Mark phone as verified — user has 30 min to complete registration
        await redisSet(`reg-verified:${phone}`, true, REG_VERIFIED_EXPIRY_SEC);

        return res.json({ success: true, message: 'Phone number verified.' });
    } catch (err) {
        next(err);
    }
};

// ─── ACTIVE SESSIONS (Module 5.1) ────────────────────────────────────────────
exports.listSessions = async (req, res, next) => {
    try {
        const sessions = await sessionService.listSessions(req.user.id);
        return res.json({
            success: true,
            sessions: sessions.map(({ token_id, ...s }) => ({ ...s, current: token_id === req.user.sid })),
        });
    } catch (err) {
        next(err);
    }
};

exports.logoutSession = async (req, res, next) => {
    try {
        const sessions = await sessionService.listSessions(req.user.id);
        const target = sessions.find((s) => s.id === req.params.id || s.token_id === req.params.id);
        if (!target) return res.status(404).json({ code: 'SESSION_NOT_FOUND', error: 'Session not found' });
        await sessionService.revokeSession(target.token_id, req.user.id);
        return res.json({ success: true, message: 'Session logged out successfully' });
    } catch (err) {
        next(err);
    }
};

// ─── GOOGLE OAUTH 2.0 (Module 5.1) ───────────────────────────────────────────
const googleRedirectUri = () => `${appUrl()}/api/v1/auth/google/callback`;

exports.googleLogin = (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({ code: 'GOOGLE_LOGIN_UNAVAILABLE', error: 'Google sign-in is not configured' });
    }
    // CSRF protection for the OAuth round-trip.
    const state = crypto.randomBytes(24).toString('hex');
    res.cookie('oauth_state', state, authCookieOptions(OAUTH_STATE_EXPIRY_SEC, '/api/v1/auth/google'));
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: googleRedirectUri(),
        response_type: 'code',
        scope: 'openid email profile',
        state,
    });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};

exports.googleCallback = async (req, res, next) => {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            return res.status(503).json({ code: 'GOOGLE_LOGIN_UNAVAILABLE', error: 'Google sign-in is not configured' });
        }
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const { code, state } = req.query;
        const expectedState = req.cookies?.oauth_state;
        res.clearCookie('oauth_state', { path: '/api/v1/auth/google' });
        if (
            !code ||
            !state ||
            !expectedState ||
            state.length !== expectedState.length ||
            !crypto.timingSafeEqual(Buffer.from(String(state)), Buffer.from(expectedState))
        ) {
            return res
                .status(400)
                .json({ code: 'INVALID_OAUTH_STATE', error: 'Sign-in request expired or was tampered with. Please try again.' });
        }

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: String(code),
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: googleRedirectUri(),
                grant_type: 'authorization_code',
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
            logger.warn('[auth/google] code exchange failed', { status: tokenRes.status, error: tokenData.error });
            return res.status(400).json({ code: 'GOOGLE_EXCHANGE_FAILED', error: 'Failed to complete Google sign-in' });
        }

        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await profileRes.json();
        if (!profileRes.ok || !profile.email || profile.verified_email === false) {
            return res.status(400).json({ code: 'GOOGLE_EMAIL_UNVERIFIED', error: 'Your Google account email is not verified' });
        }
        const email = profile.email.trim().toLowerCase();
        const name = profile.name || profile.given_name || email.split('@')[0];

        const { data: existing, error: findErr } = await supabase
            .from('users')
            .select(`id, email, full_name, phone, avatar_url, status, ${USER_ROLES_SELECT}`)
            .eq('email', email)
            .maybeSingle();
        if (findErr) throw findErr;

        let user = existing;
        if (!user) {
            // Random unusable password: the account signs in with Google (or a password reset).
            const password_hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
            const { data: created, error: createErr } = await supabase
                .from('users')
                .insert({ email, full_name: name, password_hash, email_verified: true })
                .select('id, email, full_name, phone, avatar_url, status')
                .single();
            if (createErr) throw createErr;

            const { error: roleErr } = await supabase.from('user_roles').insert({ user_id: created.id, role_id: ROLE_IDS.farmer });
            if (roleErr) {
                const { error: cleanupErr } = await supabase.from('users').delete().eq('id', created.id);
                if (cleanupErr)
                    logger.error('[auth/google] could not remove user after role assignment failed', {
                        userId: created.id,
                        error: cleanupErr.message,
                    });
                throw roleErr;
            }
            user = { ...created, roles: ['farmer'] };
        } else {
            if (user.status !== 'active') {
                return res.status(403).json({ code: 'ACCOUNT_DISABLED', error: 'This account has been disabled. Please contact support.' });
            }
            user.roles = rolesFromUserRow(user);
        }

        await startSession(user, req, res);
        recordLogin(user.id);

        // Session cookies are already set; never put tokens in a URL.
        const frontendUrl = (process.env.CLIENT_URL || appUrl()).replace(/\/$/, '');
        return res.redirect(`${frontendUrl}/?google=success`);
    } catch (err) {
        next(err);
    }
};

exports.issueAccessToken = issueAccessToken;
exports.startSession = startSession;
