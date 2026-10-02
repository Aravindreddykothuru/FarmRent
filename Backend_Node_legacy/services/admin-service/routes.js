const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');
const { HttpError } = require('../../lib/httpError');
const { ROLE_IDS, USER_ROLES_SELECT, rolesFromUserRow } = require('../../lib/roles');
const { toClientStatus } = require('../booking-service/lifecycle');

// Mounted behind auth(true) + requireRole('admin') in app.js.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_BOOKING_STATUSES = ['approved', 'active', 'return_pending'];
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_MACHINE_SELECT =
    'id, name, category, status, is_verified, is_available, daily_rate, district, state, images, avg_rating, created_at, users:owner_id(full_name, email)';

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

async function count(query) {
    const { count: n, error } = await query;
    if (error) throw error;
    return n ?? 0;
}

const limitParam = (value, fallback) => Math.min(Math.max(parseInt(value, 10) || fallback, 1), 200);

function toAdminMachine(row) {
    return {
        _id: row.id,
        id: row.id,
        name: row.name,
        type: row.category,
        status: row.status,
        isApproved: row.is_verified,
        isAvailable: row.is_available,
        pricing: { baseRatePerDay: Number(row.daily_rate) },
        location: { district: row.district, state: row.state },
        images: row.images || [],
        ratings: { average: Number(row.avg_rating || 0) },
        owner: row.users ? { name: row.users.full_name, email: row.users.email } : null,
        createdAt: row.created_at,
    };
}

// GET /api/v1/admin/dashboard
router.get(
    '/dashboard',
    asyncHandler(async (_req, res) => {
        const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
        const equipment = () => db().from('equipment').select('id', { count: 'exact', head: true }).eq('is_deleted', false);
        const rentals = () => db().from('equipment_rentals').select('id', { count: 'exact', head: true });

        const [
            totalMachines,
            availableMachines,
            pendingApprovals,
            totalBookings,
            recentBookings,
            activeBookings,
            totalUsers,
            totalOwners,
            completed,
        ] = await Promise.all([
            count(equipment()),
            count(equipment().eq('status', 'active').eq('is_available', true)),
            count(equipment().eq('is_verified', false).neq('status', 'inactive')),
            count(rentals()),
            count(rentals().gte('created_at', since)),
            count(rentals().in('status', LIVE_BOOKING_STATUSES)),
            count(db().from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null)),
            count(db().from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role_id', ROLE_IDS.owner)),
            db()
                .from('equipment_rentals')
                .select('total_amount, service_fee, deposit_amount')
                .eq('status', 'completed')
                .gte('completed_at', since),
        ]);
        if (completed.error) throw completed.error;

        // Rental value excludes the refundable deposit; the platform fee is the service fee charged on top.
        const rows = completed.data || [];
        const last30Days = rows.reduce((sum, r) => sum + Number(r.total_amount || 0) - Number(r.deposit_amount || 0), 0);
        const platformFee = rows.reduce((sum, r) => sum + Number(r.service_fee || 0), 0);

        return res.json({
            success: true,
            data: {
                overview: {
                    totalMachines,
                    availableMachines,
                    pendingApprovals,
                    totalBookings,
                    recentBookings,
                    activeBookings,
                    totalUsers,
                    totalOwners,
                },
                revenue: {
                    last30Days,
                    platformFee,
                    avgBookingValue: rows.length ? Math.round(last30Days / rows.length) : 0,
                    completedBookings: rows.length,
                    currency: 'INR',
                },
            },
        });
    }),
);

// GET /api/v1/admin/machines?approved=true|false&limit=
router.get(
    '/machines',
    asyncHandler(async (req, res) => {
        let query = db()
            .from('equipment')
            .select(ADMIN_MACHINE_SELECT)
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .limit(limitParam(req.query.limit, 50));
        if (req.query.approved === 'true') query = query.eq('is_verified', true);
        // Awaiting review: not yet verified and not already rejected.
        if (req.query.approved === 'false') query = query.eq('is_verified', false).neq('status', 'inactive');

        const { data, error } = await query;
        if (error) throw error;
        return res.json({ success: true, data: (data || []).map(toAdminMachine) });
    }),
);

async function moderateListing(req, updates) {
    if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'MACHINE_NOT_FOUND', 'Machine not found');
    const { data, error } = await db()
        .from('equipment')
        .update(updates)
        .eq('id', req.params.id)
        .eq('is_deleted', false)
        .select(ADMIN_MACHINE_SELECT)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, 'MACHINE_NOT_FOUND', 'Machine not found');

    const { redisClient } = require('../tracking-service/redisClient');
    if (redisClient?.isReady) {
        await Promise.all([redisClient.del(`machine:detail:${req.params.id}`), redisClient.incr('machine:list_version')]).catch((err) =>
            logger.warn('[admin] listing cache invalidation failed', { id: req.params.id, error: err.message }),
        );
    }
    return toAdminMachine(data);
}

// PATCH /api/v1/admin/machines/:id/approve — publish the listing
router.patch(
    '/machines/:id/approve',
    asyncHandler(async (req, res) => {
        const machine = await moderateListing(req, { is_verified: true, is_available: true, status: 'active' });
        return res.json({ success: true, data: machine });
    }),
);

// PATCH /api/v1/admin/machines/:id/reject — keep the listing out of search and booking
router.patch(
    '/machines/:id/reject',
    asyncHandler(async (req, res) => {
        const machine = await moderateListing(req, { is_verified: false, is_available: false, status: 'inactive' });
        return res.json({ success: true, data: machine });
    }),
);

// GET /api/v1/admin/users?limit=
router.get(
    '/users',
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('users')
            .select(`id, full_name, email, created_at, ${USER_ROLES_SELECT}`)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(limitParam(req.query.limit, 100));
        if (error) throw error;

        return res.json({
            success: true,
            data: (data || []).map((u) => {
                const roles = rolesFromUserRow(u);
                return { id: u.id, name: u.full_name, email: u.email, role: roles[0] ?? null, roles, created_at: u.created_at };
            }),
        });
    }),
);

// GET /api/v1/admin/bookings?limit=
router.get(
    '/bookings',
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('equipment_rentals')
            .select(
                'id, status, start_date, end_date, total_amount, payment_method, payment_status, created_at, equipment(name, category), renter:users!renter_id(full_name, email)',
            )
            .order('created_at', { ascending: false })
            .limit(limitParam(req.query.limit, 100));
        if (error) throw error;

        return res.json({
            success: true,
            data: (data || []).map((b) => ({
                _id: b.id,
                id: b.id,
                status: toClientStatus(b.status),
                startDate: b.start_date,
                endDate: b.end_date,
                start_date: b.start_date,
                end_date: b.end_date,
                totalAmount: Number(b.total_amount),
                total_amount: Number(b.total_amount),
                paymentMethod: b.payment_method,
                paymentStatus: b.payment_status,
                createdAt: b.created_at,
                equipment: b.equipment ? { name: b.equipment.name, type: b.equipment.category } : null,
                renter: b.renter ? { name: b.renter.full_name, email: b.renter.email } : null,
            })),
        });
    }),
);

module.exports = router;
