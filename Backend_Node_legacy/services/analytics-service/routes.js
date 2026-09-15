const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const { auth } = require('../../middleware/auth');
const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');

// Enforce auth on all analytics routes
router.use(auth(true));

// GET /api/v1/analytics/owner — Revenue dashboard & stats for equipment owners
router.get(
    '/owner',
    asyncHandler(async (req, res) => {
        if (!supabase) {
            return res.status(503).json({ status: 'error', message: 'Database not configured' });
        }

        const ownerId = req.user.id;

        try {
            // Fetch all bookings for the equipment owned by this user
            const { data: bookings, error: bErr } = await supabase
                .from('equipment_rentals')
                .select(
                    `
                id,
                total_amount,
                status,
                start_date,
                end_date,
                created_at,
                equipment!inner (
                    id,
                    name,
                    daily_rate
                )
            `,
                )
                .eq('owner_id', ownerId);

            if (bErr) throw bErr;

            // Fetch owner's equipment
            const { data: equipmentList, error: eErr } = await supabase
                .from('equipment')
                .select('id, name, daily_rate')
                .eq('owner_id', ownerId);

            if (eErr) throw eErr;

            const safeBookings = bookings || [];
            const safeEquipment = equipmentList || [];

            // 1. Calculations
            let totalEarnings = 0;
            let activeRentalsCount = 0;
            let completedRentalsCount = 0;
            let pendingRentalsCount = 0;

            const machineStats = {};
            safeEquipment.forEach((eq) => {
                machineStats[eq.id] = { name: eq.name, bookingsCount: 0, earnings: 0 };
            });

            safeBookings.forEach((booking) => {
                const amount = Number(booking.total_amount) || 0;
                const status = booking.status;
                const eqId = booking.equipment?.id;

                if (
                    status === 'completed' ||
                    status === 'approved' ||
                    status === 'confirmed' ||
                    status === 'active' ||
                    status === 'in_progress'
                ) {
                    totalEarnings += amount;
                    if (eqId && machineStats[eqId]) {
                        machineStats[eqId].earnings += amount;
                    }
                }

                if (status === 'active' || status === 'in_progress') {
                    activeRentalsCount++;
                } else if (status === 'completed') {
                    completedRentalsCount++;
                } else if (status === 'requested' || status === 'pending') {
                    pendingRentalsCount++;
                }

                if (eqId && machineStats[eqId]) {
                    machineStats[eqId].bookingsCount++;
                }
            });

            // 2. Earnings by month
            const monthlyEarnings = {};
            safeBookings.forEach((booking) => {
                if (booking.status !== 'cancelled' && booking.status !== 'failed') {
                    const date = new Date(booking.created_at || booking.start_date);
                    const month = date.toLocaleString('default', { month: 'short', year: '2-digit' });
                    monthlyEarnings[month] = (monthlyEarnings[month] || 0) + Number(booking.total_amount || 0);
                }
            });

            return res.json({
                success: true,
                data: {
                    totalEarnings,
                    activeRentals: activeRentalsCount,
                    completedRentals: completedRentalsCount,
                    pendingRentals: pendingRentalsCount,
                    totalEquipment: safeEquipment.length,
                    equipmentPerformance: Object.values(machineStats),
                    monthlyTrend: Object.entries(monthlyEarnings).map(([month, amount]) => ({ month, amount })),
                    timestamp: new Date().toISOString(),
                },
            });
        } catch (err) {
            logger.error('[analytics/owner] Failed to generate stats', { error: err.message });
            return res.status(500).json({ status: 'error', message: 'Failed to generate owner metrics' });
        }
    }),
);

// GET /api/v1/analytics/predictions — Retrieve ML predictive metrics (Risk, Churn, LTV) via Flask
router.get(
    '/predictions',
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        let numericId = 1; // Default fallback
        if (userId) {
            let hash = 0;
            for (let i = 0; i < userId.length; i++) {
                hash = userId.charCodeAt(i) + ((hash << 5) - hash);
            }
            numericId = Math.abs(hash % 10000) + 1;
        }

        // Predictions come only from the ML sidecar; without it there is nothing truthful to return.
        const flaskUrl = process.env.FLASK_URL;
        if (!flaskUrl) {
            return res.status(503).json({
                status: 'error',
                code: 'SERVICE_NOT_CONFIGURED',
                message: 'Predictive analytics are not enabled (FLASK_URL is not set)',
            });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
            const fetchJson = async (metric) => {
                const response = await fetch(`${flaskUrl.replace(/\/$/, '')}/api/analytics/${metric}/${numericId}`, {
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`${metric} lookup returned HTTP ${response.status}`);
                return response.json();
            };
            const [risk, churn, ltv] = await Promise.all([fetchJson('risk'), fetchJson('churn'), fetchJson('ltv')]);
            return res.json({
                success: true,
                predictions: {
                    riskScore: risk.risk_score,
                    riskTier: risk.risk_level,
                    churnProbability: churn.churn_probability,
                    predictedLTV: ltv.predicted_ltv,
                    isPredicted: true,
                },
            });
        } catch (err) {
            logger.warn('[analytics/predictions] ML sidecar request failed', { error: err.message });
            return res
                .status(502)
                .json({ status: 'error', code: 'ML_SERVICE_ERROR', message: 'Predictive analytics are temporarily unavailable' });
        } finally {
            clearTimeout(timeout);
        }
    }),
);

module.exports = router;
