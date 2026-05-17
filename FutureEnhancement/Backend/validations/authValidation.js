'use strict';

const { body } = require('express-validator');

// Auth validation schemas
const authValidation = {
    register: [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').trim().isEmail().withMessage('Please provide a valid email'),
        body('password')
            .isLength({ min: 6 })
            .withMessage('Password must be at least 6 characters long'),
        body('role')
            .optional()
            .isIn(['farmer', 'owner'])
            .withMessage('Role must be either farmer or owner'),
    ],
    login: [
        body('email').trim().notEmpty().withMessage('Email is required'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    updateProfile: [
        body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
        body('phone').optional().trim(),
        body('village').optional().trim(),
        body('district').optional().trim(),
        body('state').optional().trim(),
    ],
};

module.exports = authValidation;
