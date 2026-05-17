const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { asyncHandler } = require('../../middleware/asyncHandler');
const { auth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { changePasswordSchema } = require('../../validations/schemas');
const { validateMagicNumber, ALLOWED_IMAGE_MIMES } = require('../../middleware/validateFileType');
const supabase = require('../../lib/supabase');

// ── Avatar upload ─────────────────────────────────────────────────────────────
const avatarDir = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, avatarDir),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname) || '.jpg';
            cb(null, `avatar_${Date.now()}${ext}`);
        },
    }),
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'));
        cb(null, true);
    },
    limits: { fileSize: 3 * 1024 * 1024 },
});

// GET /api/v1/users/profile
router.get('/profile', auth(true), asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const { data, error } = await supabase
        .from('users')
        .select('id, name, email, role, phone, avatar_url, kyc_status, created_at')
        .eq('id', req.user.id)
        .single();

    if (!error && data) return res.json({ success: true, user: data });

    // kyc_status column may not exist yet — retry with safe columns and default it
    const { data: fallback, error: fallbackErr } = await supabase
        .from('users')
        .select('id, name, email, role, phone, avatar_url, created_at')
        .eq('id', req.user.id)
        .single();

    if (fallbackErr) throw fallbackErr;
    if (!fallback) return res.status(404).json({ status: 'error', message: 'User not found' });

    return res.json({ success: true, user: { ...fallback, kyc_status: 'unverified' } });
}));

// PATCH /api/v1/users/profile
router.patch('/profile', auth(true), asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const allowed = ['name', 'phone', 'avatar_url'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ status: 'error', message: 'No valid fields to update' });
    }

    const { data, error } = await supabase
        .from('users')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', req.user.id)
        .select('id, name, email, role, phone, avatar_url, created_at')
        .single();

    if (error) throw error;

    return res.json({ success: true, user: data });
}));

// POST /api/v1/users/change-password
router.post('/change-password', auth(true), validate(changePasswordSchema), asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ status: 'error', message: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters' });
    }
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const { data: user, error } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', req.user.id)
        .single();

    if (error || !user) return res.status(404).json({ status: 'error', message: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ status: 'error', message: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password_hash: newHash, updated_at: new Date().toISOString() }).eq('id', req.user.id);

    return res.json({ success: true, message: 'Password updated successfully' });
}));

// POST /api/v1/users/avatar — upload avatar image
router.post('/avatar', auth(true), (req, res, _next) => {
    avatarUpload.single('avatar')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'No file uploaded' });

        const isValid = await validateMagicNumber(req.file.path, ALLOWED_IMAGE_MIMES);
        if (!isValid) {
            return res.status(400).json({ status: 'error', message: 'Invalid file content. Only real image files are allowed.' });
        }

        const baseUrl = process.env.APP_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
        const avatarUrl = `${baseUrl}/uploads/avatars/${req.file.filename}`;

        if (supabase) {
            await supabase.from('users').update({ avatar_url: avatarUrl }).eq('id', req.user.id);
        }

        return res.json({ success: true, avatarUrl });
    });
});

// GET /api/v1/users/wallet — FarmWallet balance, FarmCoins, transaction history
router.get('/wallet', auth(true), asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const uid = req.user?.id || req.user?.sub;

    // Fetch completed payments for this user (renter side)
    const { data: payments } = await supabase
        .from('payments')
        .select('id, amount, status, created_at, booking_id, razorpay_order_id, razorpay_payment_id')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(30);

    // Fetch refunds
    const { data: refunds } = await supabase
        .from('payments')
        .select('id, amount, status, created_at, booking_id')
        .eq('user_id', uid)
        .eq('status', 'refunded')
        .limit(10);

    const paidPayments = (payments || []).filter(p => p.status === 'paid');
    const totalSpent   = paidPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const farmCoins    = Math.floor(totalSpent / 100); // 1 coin per ₹100 spent

    const transactions = [
        ...(payments || []).map(p => ({
            id:          p.id,
            type:        p.status === 'refunded' ? 'refund' : 'payment',
            amount:      p.amount || 0,
            status:      p.status,
            date:        p.created_at,
            description: p.status === 'refunded' ? 'Refund received' : 'Equipment rental payment',
            bookingId:   p.booking_id,
            paymentId:   p.razorpay_payment_id,
        })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return res.json({
        success: true,
        wallet: {
            balance:       0,         // prepaid balance — future feature
            farmCoins,
            coinValue:     farmCoins, // 1 coin = ₹1 redemption value
            totalSpent,
            transactions,
            stats: {
                totalBookings: paidPayments.length,
                totalRefunds:  (refunds || []).length,
            },
        },
    });
}));

module.exports = router;
