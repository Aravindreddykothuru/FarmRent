const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { asyncHandler } = require('../../middleware/asyncHandler');
const { auth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const {
    changePasswordSchema,
    profileUpdateSchema,
    addressCreateSchema,
    addressUpdateSchema,
    notificationPreferenceSchema,
} = require('../../validations/schemas');
const { ROLE_IDS, USER_ROLES_SELECT, rolesFromUserRow } = require('../../lib/roles');
const supabase = require('../../lib/supabase');

// ── Avatar upload ─────────────────────────────────────────────────────────────
const { uploadToS3, deleteFromS3 } = require('../../lib/s3Storage');
const crypto = require('crypto');

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'));
        cb(null, true);
    },
    limits: { fileSize: 3 * 1024 * 1024 },
});

const PROFILE_SELECT = `id, full_name, email, phone, avatar_url, kyc_status, village, district, state, created_at, ${USER_ROLES_SELECT}`;

function toProfile(row) {
    const roles = rolesFromUserRow(row);
    const { full_name, user_roles: _userRoles, ...rest } = row;
    return { ...rest, name: full_name, role: roles[0], roles };
}

async function loadProfile(userId) {
    const { data, error } = await supabase.from('users').select(PROFILE_SELECT).eq('id', userId).maybeSingle();
    if (error) throw error;
    return data;
}

// GET /api/v1/users/profile
router.get(
    '/profile',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const cacheManager = require('../../lib/cacheManager');
        const row = await cacheManager.remember(`user:profile:${req.user.id}`, 300, () => loadProfile(req.user.id));
        if (!row) return res.status(404).json({ status: 'error', code: 'USER_NOT_FOUND', message: 'User not found' });

        return res.json({ success: true, user: toProfile(row) });
    }),
);

// PATCH /api/v1/users/profile — edit contact details and/or switch between farmer and owner mode
router.patch(
    '/profile',
    auth(true),
    validate(profileUpdateSchema),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { name, phone, avatar_url, role } = req.body;
        const updates = {};
        if (name !== undefined) updates.full_name = name;
        if (avatar_url !== undefined) updates.avatar_url = avatar_url;
        if (phone !== undefined) {
            const { data: current, error: currentErr } = await supabase.from('users').select('phone').eq('id', req.user.id).maybeSingle();
            if (currentErr) throw currentErr;
            // A new or cleared number has not been proven by OTP (POST /auth/send-otp re-verifies it).
            if (current && current.phone !== phone) {
                updates.phone = phone;
                updates.phone_verified = false;
            }
        }

        if (Object.keys(updates).length === 0 && !role) {
            return res.status(400).json({ status: 'error', code: 'NO_CHANGES', message: 'No valid fields to update' });
        }

        if (Object.keys(updates).length > 0) {
            const { error } = await supabase.from('users').update(updates).eq('id', req.user.id);
            if (error?.code === '23505') {
                return res
                    .status(409)
                    .json({ status: 'error', code: 'PHONE_TAKEN', message: 'This phone number is already registered to another account' });
            }
            if (error) throw error;
        }

        const roleChanged = role && role !== req.user.role;
        if (roleChanged) {
            if (req.user.roles.includes('admin')) {
                return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'Admin accounts cannot switch mode' });
            }
            // Grant the new mode before revoking the other one so the user is never left without a role.
            const other = role === 'owner' ? 'farmer' : 'owner';
            const { error: grantErr } = await supabase
                .from('user_roles')
                .upsert({ user_id: req.user.id, role_id: ROLE_IDS[role] }, { onConflict: 'user_id,role_id', ignoreDuplicates: true });
            if (grantErr) throw grantErr;
            const { error: revokeErr } = await supabase
                .from('user_roles')
                .delete()
                .eq('user_id', req.user.id)
                .eq('role_id', ROLE_IDS[other]);
            if (revokeErr) throw revokeErr;
        }

        const cacheManager = require('../../lib/cacheManager');
        await cacheManager.del(`user:profile:${req.user.id}`);

        const row = await loadProfile(req.user.id);
        if (!row) return res.status(404).json({ status: 'error', code: 'USER_NOT_FOUND', message: 'User not found' });
        const user = toProfile(row);

        // Guards read roles from the access token, so a mode switch must re-issue it immediately.
        if (roleChanged) {
            const { issueAccessToken } = require('../../controllers/authController');
            issueAccessToken({ id: user.id, email: user.email, roles: user.roles }, res, req.user.sid);
        }

        return res.json({ success: true, user });
    }),
);

// POST /api/v1/users/change-password
router.post(
    '/change-password',
    auth(true),
    validate(changePasswordSchema),
    asyncHandler(async (req, res) => {
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ status: 'error', message: 'currentPassword and newPassword are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters' });
        }
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { data: user, error } = await supabase.from('users').select('password_hash').eq('id', req.user.id).single();

        if (error || !user) return res.status(404).json({ status: 'error', message: 'User not found' });

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) return res.status(400).json({ status: 'error', message: 'Current password is incorrect' });

        const newHash = await bcrypt.hash(newPassword, 12);
        const { error: updateError } = await supabase.from('users').update({ password_hash: newHash }).eq('id', req.user.id);
        if (updateError) throw updateError;

        const cacheManager = require('../../lib/cacheManager');
        await cacheManager.del(`user:profile:${req.user.id}`);

        // A password change signs out every other device; this device continues on a fresh session.
        const sessionService = require('../auth-service/sessionService');
        await sessionService.revokeAllSessions(req.user.id);
        const presented = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : req.cookies?.token;
        const decoded = presented ? require('jsonwebtoken').decode(presented) : null;
        if (decoded?.exp) {
            const { blockToken } = require('../../lib/tokenBlocklist');
            await blockToken(presented, decoded.exp);
        }
        const { startSession } = require('../../controllers/authController');
        await startSession({ id: req.user.id, email: req.user.email, roles: req.user.roles }, req, res);

        return res.json({ success: true, message: 'Password updated successfully' });
    }),
);

function getS3KeyFromUrl(url) {
    if (!url) return null;
    const bucket = process.env.AWS_S3_BUCKET || 'farmrent-assets';
    if (url.includes(bucket)) {
        const parts = url.split(bucket + '/');
        if (parts.length > 1) {
            return parts[1];
        }
    }
    return null;
}

// POST /api/v1/users/avatar — upload avatar image
router.post('/avatar', auth(true), (req, res, _next) => {
    avatarUpload.single('avatar')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'No file uploaded' });

        const { validateBufferMagicNumber, ALLOWED_IMAGE_MIMES } = require('../../middleware/validateFileType');
        const isValid = await validateBufferMagicNumber(req.file.buffer, ALLOWED_IMAGE_MIMES);
        if (!isValid) {
            return res.status(400).json({ status: 'error', message: 'Invalid file content. Only real image files are allowed.' });
        }

        try {
            let existingAvatarUrl = null;
            if (supabase) {
                const { data } = await supabase.from('users').select('avatar_url').eq('id', req.user.id).maybeSingle();
                existingAvatarUrl = data?.avatar_url;
            }

            // If an old avatar exists on S3, clean it up
            if (existingAvatarUrl) {
                const oldKey = getS3KeyFromUrl(existingAvatarUrl);
                if (oldKey) {
                    await deleteFromS3(oldKey).catch((delErr) => {
                        console.warn('[avatar] Failed to delete old S3 avatar:', delErr.message);
                    });
                }
            }

            const hash = crypto.randomBytes(8).toString('hex');
            const uniqueKey = `avatars/${req.user.id}-${Date.now()}-${hash}${path.extname(req.file.originalname) || '.jpg'}`;

            const avatarUrl = await uploadToS3(uniqueKey, req.file.buffer, req.file.mimetype);

            if (supabase) {
                await supabase.from('users').update({ avatar_url: avatarUrl }).eq('id', req.user.id);
            }

            // Invalidate user profile cache
            const cacheManager = require('../../lib/cacheManager');
            await cacheManager.del(`user:profile:${req.user.id}`);

            return res.json({ success: true, avatarUrl });
        } catch (uploadError) {
            console.error('[avatar] Upload failed:', uploadError.message);
            return res.status(500).json({ status: 'error', message: 'Failed to upload avatar' });
        }
    });
});

// GET /api/v1/users/wallet — FarmWallet balance, FarmCoins, transaction history
router.get(
    '/wallet',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const uid = req.user?.id || req.user?.sub;

        // Fetch completed payments for this user (renter side)
        const { data: payments } = await supabase
            .from('payments')
            .select('id, amount, status, created_at, reference_id, gateway_order_id, gateway_payment_id')
            .eq('payer_id', uid)
            .order('created_at', { ascending: false })
            .limit(30);

        // Fetch refunds
        const { data: refunds } = await supabase
            .from('payments')
            .select('id, amount, status, created_at, reference_id')
            .eq('payer_id', uid)
            .eq('status', 'refunded')
            .limit(10);

        const paidPayments = (payments || []).filter((p) => p.status === 'captured' || p.status === 'paid');
        const totalSpent = paidPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const farmCoins = Math.floor(totalSpent / 100); // 1 coin per ₹100 spent

        const transactions = [
            ...(payments || []).map((p) => ({
                id: p.id,
                type: p.status === 'refunded' ? 'refund' : 'payment',
                amount: Number(p.amount) || 0,
                status: p.status === 'captured' ? 'paid' : p.status,
                date: p.created_at,
                description: p.status === 'refunded' ? 'Refund received' : 'Equipment rental payment',
                bookingId: p.reference_id,
                paymentId: p.gateway_payment_id,
            })),
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return res.json({
            success: true,
            wallet: {
                balance: 0, // prepaid balance — future feature
                farmCoins,
                coinValue: farmCoins, // 1 coin = ₹1 redemption value
                totalSpent,
                transactions,
                stats: {
                    totalBookings: paidPayments.length,
                    totalRefunds: (refunds || []).length,
                },
            },
        });
    }),
);

// ─── ADDRESS MANAGEMENT (Module 5.2) ──────────────────────────────────────────

// GET /api/v1/users/addresses
router.get(
    '/addresses',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { data, error } = await supabase
            .from('user_addresses')
            .select('*')
            .eq('user_id', req.user.id)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;
        return res.json({ success: true, addresses: data || [] });
    }),
);

// POST /api/v1/users/addresses
router.post(
    '/addresses',
    auth(true),
    validate(addressCreateSchema),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { name, address_line1, address_line2, city, state, pincode, is_default = false } = req.body;

        if (is_default) {
            // Unset other defaults for this user
            await supabase.from('user_addresses').update({ is_default: false }).eq('user_id', req.user.id);
        }

        const { data, error } = await supabase
            .from('user_addresses')
            .insert({
                user_id: req.user.id,
                name,
                address_line1,
                address_line2: address_line2 || null,
                city,
                state,
                pincode,
                is_default,
            })
            .select()
            .single();

        if (error) throw error;
        return res.status(201).json({ success: true, address: data });
    }),
);

// PUT /api/v1/users/addresses/:id
router.put(
    '/addresses/:id',
    auth(true),
    validate(addressUpdateSchema),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { id } = req.params;
        const { name, address_line1, address_line2, city, state, pincode, is_default } = req.body;

        // Verify address ownership
        const { data: existing, error: checkErr } = await supabase
            .from('user_addresses')
            .select('id')
            .eq('id', id)
            .eq('user_id', req.user.id)
            .maybeSingle();

        if (checkErr || !existing) {
            return res.status(404).json({ status: 'error', message: 'Address not found or unauthorized' });
        }

        if (is_default) {
            // Unset other defaults for this user
            await supabase.from('user_addresses').update({ is_default: false }).eq('user_id', req.user.id);
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (address_line1 !== undefined) updates.address_line1 = address_line1;
        if (address_line2 !== undefined) updates.address_line2 = address_line2 || null;
        if (city !== undefined) updates.city = city;
        if (state !== undefined) updates.state = state;
        if (pincode !== undefined) updates.pincode = pincode;
        if (is_default !== undefined) updates.is_default = is_default;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('user_addresses')
            .update(updates)
            .eq('id', id)
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;
        return res.json({ success: true, address: data });
    }),
);

// DELETE /api/v1/users/addresses/:id
router.delete(
    '/addresses/:id',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { id } = req.params;

        // Verify ownership
        const { data: existing, error: checkErr } = await supabase
            .from('user_addresses')
            .select('id')
            .eq('id', id)
            .eq('user_id', req.user.id)
            .maybeSingle();

        if (checkErr || !existing) {
            return res.status(404).json({ status: 'error', message: 'Address not found or unauthorized' });
        }

        const { error } = await supabase.from('user_addresses').delete().eq('id', id).eq('user_id', req.user.id);

        if (error) throw error;
        return res.json({ success: true, message: 'Address deleted successfully' });
    }),
);

// ─── NOTIFICATION PREFERENCES (Module 5.2) ──────────────────────────────────

// GET /api/v1/users/preferences
router.get(
    '/preferences',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { data, error } = await supabase
            .from('notification_preferences')
            .select('email, sms, push')
            .eq('user_id', req.user.id)
            .maybeSingle();

        if (error) throw error;
        return res.json({
            success: true,
            preferences: data || { email: true, sms: true, push: true },
        });
    }),
);

// PUT /api/v1/users/preferences
router.put(
    '/preferences',
    auth(true),
    validate(notificationPreferenceSchema),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const { email, sms, push } = req.body;

        const updates = { updated_at: new Date().toISOString() };
        if (email !== undefined) updates.email = email;
        if (sms !== undefined) updates.sms = sms;
        if (push !== undefined) updates.push = push;

        const { data: existing } = await supabase.from('notification_preferences').select('id').eq('user_id', req.user.id).maybeSingle();

        let result;
        if (existing) {
            const { data, error } = await supabase
                .from('notification_preferences')
                .update(updates)
                .eq('user_id', req.user.id)
                .select('email, sms, push')
                .single();
            if (error) throw error;
            result = data;
        } else {
            const { data, error } = await supabase
                .from('notification_preferences')
                .insert({
                    user_id: req.user.id,
                    email: email !== undefined ? email : true,
                    sms: sms !== undefined ? sms : true,
                    push: push !== undefined ? push : true,
                })
                .select('email, sms, push')
                .single();
            if (error) throw error;
            result = data;
        }

        return res.json({ success: true, preferences: result });
    }),
);

module.exports = router;
