/**
 * Canonical role vocabulary.
 *
 * One list shared by the roles table (db/migrations/0001_baseline.sql), the JWT `roles` claim,
 * requireRole() guards and the frontend ('farmer' | 'owner' | 'admin').
 */
const ROLE_IDS = Object.freeze({ farmer: 1, buyer: 2, owner: 3, admin: 4, driver: 5 });

// Names issued by earlier builds that can still appear in unexpired tokens or old rows.
const LEGACY_ALIASES = Object.freeze({ equipment_owner: 'owner' });

// Roles a user may choose for themselves (registration, farmer/owner mode switch).
const SELF_SERVICE_ROLES = Object.freeze(['farmer', 'owner']);

// When a user holds several roles, the first match decides their primary role / dashboard.
const PRIMARY_ROLE_ORDER = Object.freeze(['admin', 'owner', 'farmer', 'driver', 'buyer']);

// PostgREST embed that loads a user's role names.
const USER_ROLES_SELECT = 'user_roles(role_id, roles(name))';

function normalizeRole(name) {
    if (typeof name !== 'string') return null;
    const lower = name.trim().toLowerCase();
    const canonical = LEGACY_ALIASES[lower] || lower;
    return Object.prototype.hasOwnProperty.call(ROLE_IDS, canonical) ? canonical : null;
}

function sortRoles(names) {
    const unique = [...new Set(names.map(normalizeRole).filter(Boolean))];
    return unique.sort((a, b) => PRIMARY_ROLE_ORDER.indexOf(a) - PRIMARY_ROLE_ORDER.indexOf(b));
}

/** Role names for a users row selected with USER_ROLES_SELECT. */
function rolesFromUserRow(user) {
    return sortRoles((user?.user_roles || []).map((ur) => ur?.roles?.name));
}

module.exports = {
    ROLE_IDS,
    SELF_SERVICE_ROLES,
    USER_ROLES_SELECT,
    normalizeRole,
    sortRoles,
    rolesFromUserRow,
};
