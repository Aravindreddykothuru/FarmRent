'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const catchAsync = require('../middleware/catchAsync');
const { createError } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'farmrent-super-secret-change-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRE || '7d';

// ─── Helper: sign token ───────────────────────────────────────────────────────
const signToken = (user) =>
    jwt.sign(
        { id: user._id, role: user.role, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );

/**
 * Register a new user
 * POST /api/v1/auth/register
 */
exports.register = catchAsync(async (req, res, next) => {
    const { name, email, password, role = 'farmer', phone = '', village = '', district = '', state = '' } = req.body;

    const user = await User.create({ name, email, password, role, phone, village, district, state });
    const token = signToken(user);

    res.status(201).json({
        success: true,
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
});

/**
 * Login user
 * POST /api/v1/auth/login
 */
exports.login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
        return next(createError('Incorrect email or password', 401));
    }
    if (!user.isActive) {
        return next(createError('Your account has been deactivated', 403));
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user);
    res.json({
        success: true,
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
});

/**
 * Get current logged in user
 * GET /api/v1/auth/me
 */
exports.getMe = (req, res) => {
    res.json({ success: true, user: req.user });
};

/**
 * Update user profile
 * PATCH /api/v1/auth/profile
 */
exports.updateProfile = catchAsync(async (req, res, next) => {
    const { name, phone, village, district, state } = req.body;
    const updated = await User.findByIdAndUpdate(
        req.user._id,
        { name, phone, village, district, state },
        { new: true, runValidators: true }
    );
    res.json({ success: true, user: updated });
});
