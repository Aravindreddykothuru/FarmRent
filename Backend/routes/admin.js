const express = require('express');
const router  = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const supabase = require('../lib/supabase');

// GET /api/v1/admin/dashboard
router.get('/dashboard', asyncHandler(async (req, res) => {
    if (supabase) {
        const [
            { count: totalEquipment },
            { count: totalBookings },
            { count: totalUsers },
            { count: pendingApprovals },
            { data: revenueData },
            { data: statusData },
        ] = await Promise.all([
            supabase.from('equipment').select('*', { count: 'exact', head: true }),
            supabase.from('bookings').select('*', { count: 'exact', head: true }),
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('equipment').select('*', { count: 'exact', head: true }).eq('status', 'pending_approval'),
            supabase.from('bookings').select('total_amount').neq('status', 'cancelled'),
            supabase.from('bookings').select('status'),
        ]);

        const total = (revenueData || []).reduce((s, b) => s + Number(b.total_amount), 0);
        const byStatus = (statusData || []).reduce((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {});

        return res.json({
            success: true,
            data: {
                totalMachines: totalEquipment || 0,
                totalBookings: totalBookings || 0,
                totalUsers: totalUsers || 0,
                pendingApprovals: pendingApprovals || 0,
                revenue: { total, thisMonth: total, currency: 'INR' },
                bookingsByStatus: { pending: byStatus.pending || 0, confirmed: byStatus.confirmed || 0, cancelled: byStatus.cancelled || 0 },
            },
        });
    }

    return res.status(503).json({ success: false, error: 'Database not configured' });
}));

// GET /api/v1/admin/machines
router.get('/machines', asyncHandler(async (req, res) => {
    if (supabase) {
        const { data, error } = await supabase.from('equipment').select('*, users(name, email)').order('created_at', { ascending: false });
        if (error) throw error;
        return res.json({ success: true, data });
    }
    return res.json({ success: true, data: [] });
}));

// PATCH /api/v1/admin/machines/:id/approve
router.patch('/machines/:id/approve', asyncHandler(async (req, res) => {
    if (supabase) {
        const { data, error } = await supabase.from('equipment').update({ is_approved: true, status: 'available' }).eq('id', req.params.id).select().single();
        if (error) throw error;
        return res.json({ success: true, data });
    }
    return res.json({ success: true, message: `Machine ${req.params.id} approved` });
}));

// GET /api/v1/admin/users
router.get('/users', asyncHandler(async (req, res) => {
    if (supabase) {
        const { data, error } = await supabase.from('users').select('id, name, email, role, created_at').order('created_at');
        if (error) throw error;
        return res.json({ success: true, data });
    }
    return res.status(503).json({ success: false, error: 'Database not configured' });
}));

// GET /api/v1/admin/bookings
router.get('/bookings', asyncHandler(async (req, res) => {
    if (supabase) {
        const { data, error } = await supabase.from('bookings').select('*, equipment(name,type), users!renter_id(name,email)').order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        return res.json({ success: true, data });
    }
    return res.json({ success: true, data: [] });
}));

module.exports = router;
