const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

// Stricter limiter for OTP send and password-reset (3 attempts per 10 min per IP in prod; relaxed in dev)
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 3 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many OTP requests. Please wait before trying again.' },
});

const {
    register, login, me,
    refreshAccessToken, logout,
    verifyEmail, resendVerification,
    forgotPassword, resetPassword,
    sendPhoneOTP, verifyPhoneOTP,
    regSendOTP, regVerifyOTP,
    regEmailSendOTP, regEmailVerifyOTP,
    loginSendOTP, loginVerifyOTP,
} = require('../../controllers/authController');
const { auth }     = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const {
    registerSchema, loginSchema,
    forgotPasswordSchema, resetPasswordSchema,
    sendOTPSchema, verifyOTPSchema,
    regSendOTPSchema, regVerifyOTPSchema,
    regEmailSendOTPSchema, regEmailVerifyOTPSchema,
    loginSendOTPSchema, loginVerifyOTPSchema,
} = require('../../validations/schemas');

router.get('/',  (req, res) => res.json({ message: 'Auth Service Online' }));

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
            const { data } = await supabase.from('users').select('id')
                .or(`phone.eq.${digits},phone.eq.+91${digits},phone.eq.91${digits}`)
                .maybeSingle();
            result.phoneTaken = !!data;
        }
        return res.json(result);
    } catch {
        return res.json({ emailTaken: false, phoneTaken: false }); // fail open — backend validates anyway
    }
});

// ── Core auth ─────────────────────────────────────────────────────────────────
router.post('/register', validate(registerSchema), register);
router.post('/login',    validate(loginSchema),    login);
router.get ('/me',       auth(true),               me);
router.post('/refresh',                            refreshAccessToken);
router.post('/logout',   auth(false),              logout);

// ── Email verification ────────────────────────────────────────────────────────
router.post('/verify-email',         validate(require('zod').z.object({ token: require('zod').z.string().min(1) })), verifyEmail);
router.post('/resend-verification',  validate(require('zod').z.object({ email: require('zod').z.string().email() })), resendVerification);

// ── Password reset ────────────────────────────────────────────────────────────
router.post('/forgot-password', otpLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password',              validate(resetPasswordSchema),  resetPassword);

// ── Phone OTP (post-login, for profile verification) ─────────────────────────
router.post('/send-otp',   otpLimiter, auth(true), validate(sendOTPSchema),   sendPhoneOTP);
router.post('/verify-otp',             auth(true), validate(verifyOTPSchema), verifyPhoneOTP);

// ── Phone OTP for registration (no auth) ────────────────────────────────────
router.post('/reg-send-otp',   otpLimiter, validate(regSendOTPSchema),   regSendOTP);
router.post('/reg-verify-otp',             validate(regVerifyOTPSchema), regVerifyOTP);

// ── Email OTP for registration (no auth) ─────────────────────────────────────
router.post('/reg-email-send-otp',   otpLimiter, validate(regEmailSendOTPSchema),   regEmailSendOTP);
router.post('/reg-email-verify-otp',             validate(regEmailVerifyOTPSchema), regEmailVerifyOTP);

// ── Email OTP for login (no auth) ────────────────────────────────────────────
router.post('/login-send-otp',   otpLimiter, validate(loginSendOTPSchema),   loginSendOTP);
router.post('/login-verify-otp',             validate(loginVerifyOTPSchema), loginVerifyOTP);

module.exports = router;
