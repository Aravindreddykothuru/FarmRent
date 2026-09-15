/**
 * RBAC middleware — requireRole(...roles)
 *
 * Checks req.user.roles[] (preferred, multi-role JWT) OR req.user.role (legacy single-role).
 * Usage:
 *   requireRole('admin')
 *   requireRole('farmer', 'owner')   ← any of these roles is sufficient
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: {} },
            });
        }

        // Multi-role support: check req.user.roles[] first, then fall back to req.user.role
        const userRoles =
            Array.isArray(req.user.roles) && req.user.roles.length > 0 ? req.user.roles : req.user.role ? [req.user.role] : [];

        const hasRole = allowedRoles.some((r) => userRoles.includes(r));
        if (!hasRole) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
                    details: { required: allowedRoles, actual: userRoles },
                },
            });
        }

        next();
    };
}

module.exports = { requireRole };
