'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createError } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'farmrent-super-secret-change-in-prod';

/**
 * Verify JWT token and attach user to request.
 */
const protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return next(createError('No token — please log in', 401));
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');

        if (!user || !user.isActive) {
            return next(createError('User not found or deactivated', 401));
        }

        req.user = user;
        next();
    } catch {
        next(createError('Invalid or expired token', 401));
    }
};

/**
 * Optional auth: parses token if present, assigns req.user, but does not enforce login.
 */
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        req.user = decoded; // just id, email, role (no DB call structure initially required here but usually matching protect is safer)
    } catch { /* ignore invalid token */ }
    next();
};

/**
 * Role-Based Access Control (RBAC). 
 * Restricts route access to specified roles.
 * Must be used AFTER protect middleware.
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return next(createError('Forbidden: Insufficient privileges', 403));
        }
        next();
    };
};

module.exports = { protect, optionalAuth, authorize };
