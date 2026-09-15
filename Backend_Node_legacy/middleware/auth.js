const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../lib/jwtSecret');
const { sortRoles } = require('../lib/roles');

const unauthorized = (res, code, message) =>
    res.status(401).json({
        success: false,
        error: { code, message, details: {} },
    });

/**
 * JWT authentication middleware.
 *
 * Attaches req.user = { id, role, roles, email, sid } when a valid access token is present.
 * roles[] is the authoritative source (multi-role support); role is the primary role.
 *
 * If `required` is false, unauthenticated requests pass through with req.user unset.
 */
function auth(required = true) {
    return async (req, res, next) => {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token || null;

        if (!token) {
            if (!required) return next();
            return unauthorized(res, 'UNAUTHORIZED', 'Access token required');
        }

        let payload;
        try {
            payload = jwt.verify(token, getJwtSecret());
        } catch (err) {
            return err.name === 'TokenExpiredError'
                ? unauthorized(res, 'TOKEN_EXPIRED', 'Access token expired')
                : unauthorized(res, 'INVALID_TOKEN', 'Invalid or malformed token');
        }

        // Revocation and session checks read Redis / the database. If those fail it is a server error,
        // not a reason to tell the client its token is invalid.
        try {
            // Explicitly revoked (logged out or password changed)
            const { isBlocklisted } = require('../lib/tokenBlocklist');
            if (await isBlocklisted(token)) {
                return unauthorized(res, 'INVALID_TOKEN', 'Access token has been revoked');
            }

            if (payload.sid) {
                const sessionService = require('../services/auth-service/sessionService');
                if (!(await sessionService.verifySession(payload.sid))) {
                    return unauthorized(res, 'SESSION_REVOKED', 'Session has been revoked or expired');
                }
            }
        } catch (err) {
            return next(err);
        }

        // roles[] is authoritative; a lone `role` claim is accepted from older tokens.
        // Names are normalised so legacy aliases (equipment_owner) satisfy current guards.
        const roles = sortRoles(Array.isArray(payload.roles) ? payload.roles : [payload.role]);
        const id = payload.sub || payload.id || payload.userId;
        if (!id || roles.length === 0) {
            return unauthorized(res, 'INVALID_TOKEN', 'Invalid token payload');
        }

        req.user = {
            id,
            email: payload.email || null,
            role: roles[0],
            roles,
            sid: payload.sid || null,
        };
        return next();
    };
}

module.exports = { auth };
