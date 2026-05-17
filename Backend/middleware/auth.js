const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../lib/jwtSecret');

// Simple JWT auth middleware.
// Attaches req.user = { id, role } when a valid token is present.
// If `required` is false, unauthenticated requests are allowed through.
function auth(required = true) {
    return (req, res, next) => {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;

        if (!token) {
            if (!required) return next();
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        try {
            const payload = jwt.verify(token, getJwtSecret());
            req.user = {
                id: payload.sub || payload.id || payload.userId,
                role: payload.role || 'farmer',
            };
            if (!req.user.id) {
                return res.status(401).json({ status: 'error', message: 'Invalid token payload' });
            }
            next();
        } catch (err) {
            return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
        }
    };
}

module.exports = { auth };

