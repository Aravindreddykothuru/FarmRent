'use strict';

const router = require('express').Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const authValidation = require('../validations/authValidation');

// ─── POST /api/v1/auth/register ───────────────────────────────────────────────
router.post('/register', validate(authValidation.register), authController.register);

// ─── POST /api/v1/auth/login ──────────────────────────────────────────────────
router.post('/login', validate(authValidation.login), authController.login);

// ─── GET /api/v1/auth/me ──────────────────────────────────────────────────────
router.get('/me', protect, authController.getMe);

// ─── PATCH /api/v1/auth/profile ───────────────────────────────────────────────
router.patch('/profile', protect, validate(authValidation.updateProfile), authController.updateProfile);

module.exports = router;
