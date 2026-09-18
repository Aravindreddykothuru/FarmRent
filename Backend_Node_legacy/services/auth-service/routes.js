const express = require('express');
const router = express.Router();
const { loginLimiter } = require('../../middleware/redisRateLimiter');
const { otpSendLimiter, otpVerifyLimiter, passwordResetLimiter, loginIpLimiter } = require('../../middleware/slidingWindowRateLimiter');

const {
    register,
    login,
    me,
    refreshAccessToken,
    logout,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    sendPhoneOTP,
    verifyPhoneOTP,
    regSendOTP,
    regVerifyOTP,
    regEmailSendOTP,
    regEmailVerifyOTP,
    loginSendOTP,
    loginVerifyOTP,
    listSessions,
    logoutSession,
    googleLogin,
    googleCallback,
} = require('../../controllers/authController');
const { auth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const {
    registerSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    sendOTPSchema,
    verifyOTPSchema,
    regSendOTPSchema,
    regVerifyOTPSchema,
    regEmailSendOTPSchema,
    regEmailVerifyOTPSchema,
    loginSendOTPSchema,
    loginVerifyOTPSchema,
} = require('../../validations/schemas');

router.get('/', (req, res) => res.json({ message: 'Auth Service Online' }));

// ── Check email / phone availability (registration duplicate check) ──────────
router.get('/check-availability', async (req, res) => {
    try {
        const { email, phone } = req.query;
        if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });
        const supabase = require('../../lib/supabase');
        if (!supabase) return res.json({ emailTaken: false, phoneTaken: false });

        const result = { emailTaken: false, phoneTaken: false };
        if (email) {
            const { data } = await supabase.from('users').select('id').eq('email', String(email).toLowerCase().trim()).maybeSingle();
            result.emailTaken = !!data;
        }
        if (phone) {
            const digits = String(phone).replace(/\D/g, '').slice(-10);
            const { data } = await supabase
                .from('users')
                .select('id')
                .or(`phone.eq.${digits},phone.eq.+91${digits},phone.eq.91${digits}`)
                .maybeSingle();
            result.phoneTaken = !!data;
        }
        return res.json(result);
    } catch {
        return res.json({ emailTaken: false, phoneTaken: false }); // fail open — backend validates anyway
    }
});

// ── Core auth ───────────────────────────────────────────────────────────────
// Two counters, on purpose: loginLimiter is per IP *and* account, so neighbours sharing a village connection
// do not lock each other out, and loginIpLimiter caps what any single IP can do across all accounts.
router.post('/register', loginIpLimiter, loginLimiter, validate(registerSchema), register);
router.post('/login', loginIpLimiter, loginLimiter, validate(loginSchema), login);
router.get('/me', auth(true), me);
router.post('/refresh', refreshAccessToken);
// No auth middleware: signing out must also work once the access token has expired (see the controller).
router.post('/logout', logout);

// ── Email verification ────────────────────────────────────────────────────────
router.post('/verify-email', validate(require('zod').z.object({ token: require('zod').z.string().min(1) })), verifyEmail);
router.post('/resend-verification', validate(require('zod').z.object({ email: require('zod').z.string().email() })), resendVerification);

// ── Password reset ────────────────────────────────────────────────────────────
router.post('/forgot-password', passwordResetLimiter, otpSendLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

// ── Active Sessions ──────────────────────────────────────────────────────────
router.get('/sessions', auth(true), listSessions);
router.post('/sessions/:id/logout', auth(true), logoutSession);

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get('/google', googleLogin);
router.get('/google/callback', googleCallback);

// ── Phone OTP (post-login, for profile verification) ─────────────────────────────
router.post('/send-otp', otpSendLimiter, auth(true), validate(sendOTPSchema), sendPhoneOTP);
router.post('/verify-otp', auth(true), otpVerifyLimiter, validate(verifyOTPSchema), verifyPhoneOTP);

// ── Phone OTP for registration (no auth) ─────────────────────────────────────────
router.post('/reg-send-otp', otpSendLimiter, validate(regSendOTPSchema), regSendOTP);
router.post('/reg-verify-otp', otpVerifyLimiter, validate(regVerifyOTPSchema), regVerifyOTP);

// ── Email OTP for registration (no auth) ─────────────────────────────────────────
router.post('/reg-email-send-otp', otpSendLimiter, validate(regEmailSendOTPSchema), regEmailSendOTP);
router.post('/reg-email-verify-otp', otpVerifyLimiter, validate(regEmailVerifyOTPSchema), regEmailVerifyOTP);

// ── Email OTP for login (no auth) ─────────────────────────────────────────────────
router.post('/login-send-otp', otpSendLimiter, validate(loginSendOTPSchema), loginSendOTP);
router.post('/login-verify-otp', otpVerifyLimiter, validate(loginVerifyOTPSchema), loginVerifyOTP);

module.exports = router;
