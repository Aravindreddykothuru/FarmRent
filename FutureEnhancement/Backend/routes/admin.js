'use strict';

const router = require('express').Router();
const Machine = require('../models/Machine');
const Booking = require('../models/Booking');
const { sendSuccess, createError } = require('../utils/helpers');

// Helper: try loading User model (may be stub)
let User;
try { User = require('../models/User'); } catch { User = null; }

// ─── GET /api/v1/admin/dashboard ─────────────────────────────────────────────
// Real-time platform stats for admin dashboard
router.get('/dashboard', async (req, res, next) => {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        const [
            totalMachines,
            availableMachines,
            pendingApprovals,
            totalBookings,
            recentBookings,
            activeBookings,
            topMachines,
        ] = await Promise.all([
            Machine.countDocuments({ isActive: true }),
            Machine.countDocuments({ isActive: true, status: 'available' }),
            Machine.countDocuments({ isActive: true, isApproved: false }),
            Booking.countDocuments({}),
            Booking.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
            Booking.countDocuments({ status: { $in: ['confirmed', 'active'] } }),
            Machine.find({ isActive: true })
                .sort({ totalBookings: -1 })
                .limit(5)
                .select('name type totalBookings pricing.baseRatePerDay location.district ratings')
                .lean(),
        ]);

        // Revenue aggregation
        const revenueData = await Booking.aggregate([
            { $match: { status: { $in: ['confirmed', 'completed'] }, createdAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' }, avgBookingValue: { $avg: '$totalAmount' } } },
        ]);

        const revenue = revenueData[0] || { totalRevenue: 0, avgBookingValue: 0 };

        // Bookings by type breakdown
        const bookingsByType = await Booking.aggregate([
            { $lookup: { from: 'machines', localField: 'machine', foreignField: '_id', as: 'machine' } },
            { $unwind: { path: '$machine', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$machine.type', count: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
            { $sort: { count: -1 } },
            { $limit: 8 },
        ]);

        sendSuccess(res, {
            overview: {
                totalMachines,
                availableMachines,
                pendingApprovals,
                totalBookings,
                recentBookings,
                activeBookings,
            },
            revenue: {
                last30Days: Math.round(revenue.totalRevenue),
                avgBookingValue: Math.round(revenue.avgBookingValue),
                platformFee: Math.round(revenue.totalRevenue * 0.1),
            },
            topMachines,
            bookingsByType,
        });
    } catch (err) {
        next(err);
    }
});

// ─── GET /api/v1/admin/machines ───────────────────────────────────────────────
// All machines including unapproved (admin view)
router.get('/machines', async (req, res, next) => {
    try {
        const { approved, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (approved === 'false') filter.isApproved = false;
        if (approved === 'true') filter.isApproved = true;

        const skip = (Number(page) - 1) * Number(limit);
        const [data, total] = await Promise.all([
            Machine.find(filter).skip(skip).limit(Number(limit)).sort({ createdAt: -1 }).lean(),
            Machine.countDocuments(filter),
        ]);
        sendSuccess(res, data, { total, page: Number(page), limit: Number(limit) });
    } catch (err) { next(err); }
});

// ─── PATCH /api/v1/admin/machines/:id/approve ────────────────────────────────
router.patch('/machines/:id/approve', async (req, res, next) => {
    try {
        const machine = await Machine.findByIdAndUpdate(
            req.params.id,
            { isApproved: true, status: 'available' },
            { new: true }
        ).lean();
        if (!machine) return next(createError(404, 'Machine not found'));
        sendSuccess(res, machine);
    } catch (err) { next(err); }
});

// ─── PATCH /api/v1/admin/machines/:id/reject ─────────────────────────────────
router.patch('/machines/:id/reject', async (req, res, next) => {
    try {
        const machine = await Machine.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        ).lean();
        if (!machine) return next(createError(404, 'Machine not found'));
        sendSuccess(res, machine);
    } catch (err) { next(err); }
});

// ─── GET /api/v1/admin/bookings ───────────────────────────────────────────────
router.get('/bookings', async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const filter = status ? { status } : {};
        const skip = (Number(page) - 1) * Number(limit);
        const [data, total] = await Promise.all([
            Booking.find(filter).skip(skip).limit(Number(limit))
                .populate('machine', 'name type location')
                .sort({ createdAt: -1 }).lean(),
            Booking.countDocuments(filter),
        ]);
        sendSuccess(res, data, { total, page: Number(page), limit: Number(limit) });
    } catch (err) { next(err); }
});

module.exports = router;
